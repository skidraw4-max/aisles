/**
 * Site context (JD t567/t568, P1): what the site is for, entered by the service owner.
 * Stored inside the existing JuryServiceConnection.providerConfig JSON as `siteContext` (no migration).
 * It is user-entered — never treated as observed evidence. referenceUrl is stored only and not used by reviews yet.
 */
import { randomUUID } from 'node:crypto';
import { decideJuryMutation, type JuryActor } from './access';
import { containsSecret } from './agent-execution';

import { SITE_CONTEXT_LIMITS, SITE_TYPES, type SiteContext } from './site-context-types';
export { SITE_CONTEXT_LIMITS, SITE_TYPES, type SiteContext, type SiteType } from './site-context-types';

export type SiteContextInput = { siteType: string; primaryUsers: string; coreTasks: string; brandTraits: string; referenceUrl: string };
export type SiteContextFailure = 'INVALID_SITE_TYPE' | 'INVALID_URL' | 'SECRET_LIKE' | 'EMPTY';

function clean(v: unknown, max: number): string {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t.length > max ? t.slice(0, max) : t;
}

export function siteTypeLabel(value: string): string {
  return SITE_TYPES.find((t) => t.value === value)?.label ?? '기타';
}

export function normalizeSiteContext(input: SiteContextInput, now: Date): { ok: true; value: SiteContext } | { ok: false; reason: SiteContextFailure } {
  const siteType = SITE_TYPES.find((t) => t.value === input.siteType)?.value;
  if (!siteType) return { ok: false, reason: 'INVALID_SITE_TYPE' };
  const coreTasks = String(input.coreTasks ?? '')
    .split(/\r?\n/)
    .map((t) => clean(t, SITE_CONTEXT_LIMITS.task))
    .filter(Boolean)
    .slice(0, SITE_CONTEXT_LIMITS.tasks);
  const rawUrl = clean(input.referenceUrl, SITE_CONTEXT_LIMITS.url);
  let referenceUrl: string | null = null;
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'INVALID_URL' };
      if (u.username || u.password) return { ok: false, reason: 'INVALID_URL' };
      referenceUrl = u.toString();
    } catch {
      return { ok: false, reason: 'INVALID_URL' };
    }
  }
  const value: SiteContext = {
    siteType,
    primaryUsers: clean(input.primaryUsers, SITE_CONTEXT_LIMITS.text),
    coreTasks,
    brandTraits: clean(input.brandTraits, SITE_CONTEXT_LIMITS.text),
    referenceUrl,
    updatedAt: now.toISOString(),
  };
  if (containsSecret(value)) return { ok: false, reason: 'SECRET_LIKE' };
  return { ok: true, value };
}

/** Tolerant reader: null when absent or malformed (old connections have no siteContext). */
export function readSiteContext(providerConfig: unknown): SiteContext | null {
  if (!providerConfig || typeof providerConfig !== 'object') return null;
  const raw = (providerConfig as { siteContext?: unknown }).siteContext;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const siteType = SITE_TYPES.find((t) => t.value === o.siteType)?.value;
  if (!siteType) return null;
  return {
    siteType,
    primaryUsers: clean(o.primaryUsers, SITE_CONTEXT_LIMITS.text),
    coreTasks: Array.isArray(o.coreTasks) ? o.coreTasks.map((t) => clean(t, SITE_CONTEXT_LIMITS.task)).filter(Boolean).slice(0, SITE_CONTEXT_LIMITS.tasks) : [],
    brandTraits: clean(o.brandTraits, SITE_CONTEXT_LIMITS.text),
    referenceUrl: typeof o.referenceUrl === 'string' && o.referenceUrl ? clean(o.referenceUrl, SITE_CONTEXT_LIMITS.url) : null,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
  };
}

/** Merge one key into providerConfig without dropping the others (e.g. ga4). */
export function mergeProviderConfig(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  return { ...base, ...patch };
}

export interface SiteContextStore {
  findConnection(tenantId: string, connectionId: string): Promise<{ id: string; tenantId: string; serviceKey: string; status: string } | null>;
  /** Read-merge-write inside one transaction so other providerConfig keys survive. */
  saveSiteContext(row: { tenantId: string; connectionId: string; siteContext: SiteContext; now: Date }): Promise<void>;
  audit(event: { tenantId: string; actor: string; action: string; serviceKey: string; timestamp: Date }): Promise<void>;
}

export type SaveSiteContextFailure = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'TENANT_MISMATCH' | 'NOT_FOUND' | 'CONNECTION_DELETED' | SiteContextFailure;

export async function saveSiteContext(input: {
  actor: JuryActor;
  connectionId: string;
  input: SiteContextInput;
  store: SiteContextStore;
  now?: Date;
}): Promise<{ ok: true; siteContext: SiteContext } | { ok: false; reason: SaveSiteContextFailure }> {
  if (!input.actor.ok) return { ok: false, reason: input.actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' };
  const connection = await input.store.findConnection(input.actor.tenantId, input.connectionId);
  if (!connection) return { ok: false, reason: 'NOT_FOUND' };
  const allowed = decideJuryMutation({ actor: input.actor, action: 'connection.write', resourceTenantId: connection.tenantId });
  if (!allowed.ok) return { ok: false, reason: allowed.reason === 'TENANT_MISMATCH' ? 'TENANT_MISMATCH' : 'FORBIDDEN' };
  if (connection.status === 'DISCONNECTED') return { ok: false, reason: 'CONNECTION_DELETED' };
  const now = input.now ?? new Date();
  const normalized = normalizeSiteContext(input.input, now);
  if (!normalized.ok) return normalized;
  await input.store.saveSiteContext({ tenantId: connection.tenantId, connectionId: connection.id, siteContext: normalized.value, now });
  await input.store.audit({ tenantId: connection.tenantId, actor: input.actor.userId, action: 'SITE_CONTEXT_UPDATED', serviceKey: connection.serviceKey, timestamp: now });
  return { ok: true, siteContext: normalized.value };
}

export async function createPrismaSiteContextStore(): Promise<SiteContextStore> {
  const { prisma } = await import('@/lib/prisma');
  return {
    async findConnection(tenantId, connectionId) {
      return prisma.juryServiceConnection.findFirst({ where: { id: connectionId, tenantId }, select: { id: true, tenantId: true, serviceKey: true, status: true } });
    },
    async saveSiteContext(row) {
      await prisma.$transaction(async (tx) => {
        const current = await tx.juryServiceConnection.findFirst({ where: { id: row.connectionId, tenantId: row.tenantId }, select: { providerConfig: true } });
        if (!current) return;
        await tx.juryServiceConnection.updateMany({
          where: { id: row.connectionId, tenantId: row.tenantId },
          data: { providerConfig: mergeProviderConfig(current.providerConfig, { siteContext: row.siteContext }) as never, updatedAt: row.now },
        });
      });
    },
    async audit(event) {
      await prisma.juryAuditEvent.create({ data: { id: randomUUID(), tenantId: event.tenantId, actor: event.actor, action: event.action, serviceKey: event.serviceKey, timestamp: event.timestamp } });
    },
  };
}

/** Page read for the settings form. Tenant-scoped; null when absent. */
export async function loadSiteContext(tenantId: string, connectionId: string): Promise<SiteContext | null> {
  const { prisma } = await import('@/lib/prisma');
  const row = await prisma.juryServiceConnection.findFirst({ where: { id: connectionId, tenantId }, select: { providerConfig: true } });
  return readSiteContext(row?.providerConfig);
}
