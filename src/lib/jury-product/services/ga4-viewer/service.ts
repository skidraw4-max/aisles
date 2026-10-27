/**
 * I-075/I-076: GA4_VIEWER connection. The customer invites the Jury service account as a GA4 Viewer and gives
 * the property id. We validate with one minimal runReport, then save only non-secret config:
 *   providerConfig.ga4 = { propertyId, validatedAt }, credentialRef = "ga4-viewer/properties/<id>" (pointer, not a secret)
 * and a consent row (version ga4-viewer-consent-v1). GA4_VIEWER is never ownership-gated.
 */
import { createHash, randomUUID } from 'node:crypto';
import { decideJuryMutation, type JuryActor } from '../../access';
import type { AttachGa4Options } from '@/lib/ai-review-board/ga4-evidence';
import { ga4ViewerFlags, type EnvLike } from '../phase1-flags';
import type { FetchLike } from './credentials';
import { GA4_VIEWER_CONSENT_VERSION } from './consent-text';
import { createJuryGa4ReportFetcher, normalizeGa4PropertyId, validateGa4ViewerAccess, type Ga4ValidationFailure } from './data-api';

export type Ga4ProviderConfig = { propertyId: string; validatedAt: string };

export function readGa4ProviderConfig(providerConfig: unknown): Ga4ProviderConfig | null {
  if (!providerConfig || typeof providerConfig !== 'object') return null;
  const ga4 = (providerConfig as { ga4?: unknown }).ga4;
  if (!ga4 || typeof ga4 !== 'object') return null;
  const propertyId = normalizeGa4PropertyId(String((ga4 as { propertyId?: unknown }).propertyId ?? ''));
  const validatedAt = String((ga4 as { validatedAt?: unknown }).validatedAt ?? '');
  return propertyId && validatedAt ? { propertyId, validatedAt } : null;
}

export interface Ga4ViewerStore {
  findConnection(tenantId: string, connectionId: string): Promise<{ id: string; tenantId: string; serviceKey: string; accessMethod: string; providerConfig: unknown } | null>;
  saveValidated(row: { tenantId: string; connectionId: string; propertyId: string; validatedAt: Date; userId: string; consentVersion: string }): Promise<void>;
  audit(event: { tenantId: string; actor: string; action: string; serviceKey: string; timestamp: Date }): Promise<void>;
}

export type Ga4ConnectFailure = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'TENANT_MISMATCH' | 'NOT_FOUND' | 'NOT_ENABLED' | 'CONSENT_REQUIRED' | 'ACCESS_METHOD_UNSUPPORTED' | Ga4ValidationFailure;

export async function connectGa4Viewer(input: {
  actor: JuryActor;
  connectionId: string;
  propertyId: string;
  accepted: boolean;
  store: Ga4ViewerStore;
  env?: EnvLike;
  fetch?: FetchLike;
  oidcToken?: () => Promise<string | null>;
  now?: Date;
}): Promise<{ ok: true; propertyId: string } | { ok: false; reason: Ga4ConnectFailure }> {
  const env = input.env ?? process.env;
  if (!ga4ViewerFlags(env).enabled) return { ok: false, reason: 'NOT_ENABLED' };
  if (!input.actor.ok) return { ok: false, reason: input.actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' };
  const connection = await input.store.findConnection(input.actor.tenantId, input.connectionId);
  if (!connection) return { ok: false, reason: 'NOT_FOUND' };
  const allowed = decideJuryMutation({ actor: input.actor, action: 'connection.write', resourceTenantId: connection.tenantId });
  if (!allowed.ok) return { ok: false, reason: allowed.reason === 'TENANT_MISMATCH' ? 'TENANT_MISMATCH' : 'FORBIDDEN' };
  if (connection.accessMethod !== 'GA4_VIEWER') return { ok: false, reason: 'ACCESS_METHOD_UNSUPPORTED' };
  if (!input.accepted) return { ok: false, reason: 'CONSENT_REQUIRED' };
  const validated = await validateGa4ViewerAccess(input.propertyId, { env, fetch: input.fetch, oidcToken: input.oidcToken });
  if (!validated.ok) return { ok: false, reason: validated.code };
  const now = input.now ?? new Date();
  await input.store.saveValidated({
    tenantId: connection.tenantId,
    connectionId: connection.id,
    propertyId: validated.propertyId,
    validatedAt: now,
    userId: input.actor.userId,
    consentVersion: GA4_VIEWER_CONSENT_VERSION,
  });
  await input.store.audit({ tenantId: connection.tenantId, actor: input.actor.userId, action: 'GA4_VIEWER_CONNECTED', serviceKey: connection.serviceKey, timestamp: now });
  return { ok: true, propertyId: validated.propertyId };
}

/**
 * Per-connection GA4 options for attachGa4Evidence. The credentialsJson placeholder only satisfies the shape check
 * in ai-review-board; it carries no key — the injected fetchReport authenticates with the Jury service account.
 * Returns null when the connection is not a validated GA4_VIEWER or the flag is off (=> no GA4, as before).
 */
export function ga4OptionsForConnection(
  connection: { accessMethod: string; providerConfig?: unknown },
  deps: { env?: EnvLike; fetch?: FetchLike; oidcToken?: () => Promise<string | null> } = {},
): AttachGa4Options | null {
  const env = deps.env ?? process.env;
  const flags = ga4ViewerFlags(env);
  if (!flags.enabled || connection.accessMethod !== 'GA4_VIEWER') return null;
  const config = readGa4ProviderConfig(connection.providerConfig);
  if (!config) return null;
  return {
    propertyId: config.propertyId,
    credentialsJson: JSON.stringify({ client_email: flags.serviceAccountEmail, private_key: 'jury-ga4-viewer:injected-fetcher' }),
    fetchReport: createJuryGa4ReportFetcher({ env, fetch: deps.fetch, oidcToken: deps.oidcToken }),
  };
}

export async function createPrismaGa4ViewerStore(): Promise<Ga4ViewerStore> {
  const { prisma } = await import('@/lib/prisma');
  return {
    async findConnection(tenantId, connectionId) {
      return prisma.juryServiceConnection.findFirst({
        where: { id: connectionId, tenantId },
        select: { id: true, tenantId: true, serviceKey: true, accessMethod: true, providerConfig: true },
      });
    },
    async saveValidated(row) {
      await prisma.$transaction(async (tx) => {
        await tx.juryServiceConnection.updateMany({
          where: { id: row.connectionId, tenantId: row.tenantId, accessMethod: 'GA4_VIEWER' },
          data: {
            providerConfig: { ga4: { propertyId: row.propertyId, validatedAt: row.validatedAt.toISOString() } },
            credentialRef: `ga4-viewer/properties/${row.propertyId}`,
            updatedAt: row.validatedAt,
          },
        });
        await tx.juryConnectionConsent.create({
          data: {
            id: randomUUID(),
            tenantId: row.tenantId,
            connectionId: row.connectionId,
            userId: row.userId,
            version: row.consentVersion,
            scopeHash: createHash('sha256').update(JSON.stringify({ version: row.consentVersion, propertyId: row.propertyId })).digest('hex'),
            acceptedAt: row.validatedAt,
            scope: { ga4PropertyId: row.propertyId },
          },
        });
      });
    },
    async audit(event) {
      await prisma.juryAuditEvent.create({
        data: { id: randomUUID(), tenantId: event.tenantId, actor: event.actor, action: event.action, serviceKey: event.serviceKey, accessMethod: 'GA4_VIEWER', timestamp: event.timestamp },
      });
    },
  };
}
