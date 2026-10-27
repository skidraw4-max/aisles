/**
 * I-079: service connection delete (soft delete + immediate revocation).
 * - OWNER/ADMIN only, tenant from the session (never from the client), typed displayName confirmation.
 * - Revokes now: stored login credentials (ciphertext wiped), consents, GA4/provider settings, ownership.
 * - Cancels running screen audits and queued/running reviews; purges screenshots from the private bucket.
 * - The connection row is kept (status DISCONNECTED) so reviews, decisions, and audit history stay readable.
 * - Audit event stores counts only (no names, keys, or secrets).
 */
import type { JuryActor } from '../../access';
import type { ScreenshotSink } from '../screen-audit/screenshot-store';

export const CONNECTION_DELETED_ACTION = 'CONNECTION_DELETED';
const PURGE_CHUNK = 100;

export type DeletableConnection = {
  id: string;
  tenantId: string;
  displayName: string;
  serviceKey: string;
  accessMethod: string;
  status: string;
};

export type DisconnectCounts = {
  credentialsDestroyed: number;
  consentsRevoked: number;
  ownershipRevoked: number;
  auditsCancelled: number;
  reviewsCancelled: number;
};

export interface ConnectionDeleteStore {
  findConnection(tenantId: string, connectionId: string): Promise<DeletableConnection | null>;
  listScreenshotKeys(tenantId: string, connectionId: string): Promise<Array<{ id: string; storageKey: string }>>;
  markScreenshotsDeleted(tenantId: string, ids: string[], now: Date): Promise<void>;
  /** One transaction: revoke everything, set DISCONNECTED, write the audit event. */
  disconnect(input: { tenantId: string; connectionId: string; userId: string; now: Date; serviceKey: string; accessMethod: string; screenshotsPending: number }): Promise<DisconnectCounts>;
}

export type ConnectionDeleteFailure = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'NAME_MISMATCH' | 'FAILED';

export type ConnectionDeleteResult =
  | {
      ok: true;
      state: 'DELETED' | 'ALREADY_DELETED';
      /** True when some screenshots could not be removed yet; deleting again retries the purge. */
      screenshotsPending: boolean;
      screenshotsDeleted: number;
      githubUninstallNeeded: boolean;
      counts: DisconnectCounts | null;
    }
  | { ok: false; reason: ConnectionDeleteFailure };

export function canDeleteConnection(actor: JuryActor): boolean {
  return actor.ok && (actor.role === 'OWNER' || actor.role === 'ADMIN');
}

export function isGithubConnection(connection: { serviceKey: string }): boolean {
  return connection.serviceKey.startsWith('github-');
}

export function confirmationMatches(displayName: string, typed: string): boolean {
  const want = displayName.normalize('NFC').trim();
  return want.length > 0 && typed.normalize('NFC').trim() === want;
}

async function purgeScreenshots(store: ConnectionDeleteStore, sink: ScreenshotSink | null, tenantId: string, connectionId: string, now: Date) {
  const rows = await store.listScreenshotKeys(tenantId, connectionId);
  if (rows.length === 0) return { deleted: 0, pending: 0 };
  if (!sink) return { deleted: 0, pending: rows.length };
  let deleted = 0;
  for (let i = 0; i < rows.length; i += PURGE_CHUNK) {
    const chunk = rows.slice(i, i + PURGE_CHUNK);
    try {
      await sink.remove(chunk.map((row) => row.storageKey));
      await store.markScreenshotsDeleted(tenantId, chunk.map((row) => row.id), now);
      deleted += chunk.length;
    } catch {
      // Keep storageKey so a later delete (or the daily retention purge) retries.
    }
  }
  return { deleted, pending: rows.length - deleted };
}

export async function deleteServiceConnection(input: {
  actor: JuryActor;
  connectionId: string;
  confirmName: string;
  store: ConnectionDeleteStore;
  sink: ScreenshotSink | null;
  now?: Date;
  /** Client-supplied tenant is ignored on purpose. */
  clientTenantId?: string | null;
}): Promise<ConnectionDeleteResult> {
  void input.clientTenantId;
  const { actor } = input;
  if (!actor.ok) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!canDeleteConnection(actor)) return { ok: false, reason: 'FORBIDDEN' };
  const connectionId = input.connectionId.trim();
  if (!connectionId) return { ok: false, reason: 'NOT_FOUND' };
  const now = input.now ?? new Date();
  try {
    const connection = await input.store.findConnection(actor.tenantId, connectionId);
    if (!connection || connection.tenantId !== actor.tenantId) return { ok: false, reason: 'NOT_FOUND' };
    const githubUninstallNeeded = isGithubConnection(connection);
    if (connection.status === 'DISCONNECTED') {
      // Idempotent: only retry the screenshot purge.
      const purge = await purgeScreenshots(input.store, input.sink, actor.tenantId, connection.id, now);
      return { ok: true, state: 'ALREADY_DELETED', screenshotsPending: purge.pending > 0, screenshotsDeleted: purge.deleted, githubUninstallNeeded, counts: null };
    }
    if (!confirmationMatches(connection.displayName, input.confirmName)) return { ok: false, reason: 'NAME_MISMATCH' };
    // Revoke first so nothing new can run, then purge storage.
    const pendingBefore = (await input.store.listScreenshotKeys(actor.tenantId, connection.id)).length;
    const counts = await input.store.disconnect({
      tenantId: actor.tenantId,
      connectionId: connection.id,
      userId: actor.userId,
      now,
      serviceKey: connection.serviceKey,
      accessMethod: connection.accessMethod,
      screenshotsPending: pendingBefore,
    });
    const purge = await purgeScreenshots(input.store, input.sink, actor.tenantId, connection.id, now);
    return { ok: true, state: 'DELETED', screenshotsPending: purge.pending > 0, screenshotsDeleted: purge.deleted, githubUninstallNeeded, counts };
  } catch {
    return { ok: false, reason: 'FAILED' };
  }
}

export function connectionDeleteMessage(result: ConnectionDeleteResult): string {
  if (result.ok) {
    const base = result.state === 'ALREADY_DELETED' ? '이미 삭제된 연결이에요.' : '연결을 삭제했어요. 저장된 로그인 정보와 동의, GA4 설정, 소유권 확인을 모두 해제했어요.';
    const shots = result.screenshotsPending ? ' 일부 화면 캡처를 아직 지우지 못했어요. 잠시 후 다시 삭제를 눌러 주세요.' : '';
    const gh = result.githubUninstallNeeded ? ' GitHub 앱은 GitHub 설정에서 직접 제거해 주세요.' : '';
    return base + shots + gh;
  }
  switch (result.reason) {
    case 'UNAUTHENTICATED':
      return '로그인이 필요해요.';
    case 'FORBIDDEN':
      return '연결 삭제는 조직 소유자나 관리자만 할 수 있어요.';
    case 'NOT_FOUND':
      return '연결을 찾을 수 없어요.';
    case 'NAME_MISMATCH':
      return '서비스 이름이 일치하지 않아요. 이름을 정확히 입력해 주세요.';
    default:
      return '연결을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}

export async function createPrismaConnectionDeleteStore(): Promise<ConnectionDeleteStore> {
  const [{ prisma }, { Prisma }, { JURY_INTERACTIVE_TRANSACTION }, { randomUUID }] = await Promise.all([
    import('@/lib/prisma'),
    import('@prisma/client'),
    import('../../persistence-diagnostic'),
    import('node:crypto'),
  ]);
  return {
    async findConnection(tenantId, connectionId) {
      return prisma.juryServiceConnection.findFirst({
        where: { id: connectionId, tenantId },
        select: { id: true, tenantId: true, displayName: true, serviceKey: true, accessMethod: true, status: true },
      });
    },
    async listScreenshotKeys(tenantId, connectionId) {
      const rows = await prisma.juryAuditEvidence.findMany({
        where: { tenantId, deletedAt: null, storageKey: { not: null }, audit: { connectionId, tenantId } },
        select: { id: true, storageKey: true },
      });
      return rows.filter((row): row is { id: string; storageKey: string } => typeof row.storageKey === 'string');
    },
    async markScreenshotsDeleted(tenantId, ids, now) {
      await prisma.juryAuditEvidence.updateMany({ where: { tenantId, id: { in: ids }, deletedAt: null }, data: { deletedAt: now, storageKey: null } });
    },
    async disconnect(input) {
      return prisma.$transaction(async (tx) => {
        const where = { tenantId: input.tenantId, connectionId: input.connectionId };
        const credentials = await tx.juryAccountCredential.updateMany({
          where: { ...where, destroyedAt: null },
          data: { ciphertext: null, iv: null, authTag: null, wrappedDek: null, usernameHint: null, destroyedAt: input.now, destroyReason: CONNECTION_DELETED_ACTION },
        });
        const consents = await tx.juryConnectionConsent.deleteMany({ where });
        const ownership = await tx.juryOwnershipVerification.updateMany({
          where: { ...where, status: { not: 'REVOKED' } },
          data: { status: 'REVOKED' },
        });
        const audits = await tx.juryVisualAudit.updateMany({
          where: { ...where, state: { in: ['QUEUED', 'RUNNING'] } },
          data: { state: 'FAILED', finishedAt: input.now },
        });
        const reviews = await tx.juryReviewRequest.updateMany({
          where: { ...where, status: { in: ['QUEUED', 'RUNNING'] } },
          data: { status: 'FAILED', failureReason: CONNECTION_DELETED_ACTION },
        });
        await tx.juryServiceConnection.updateMany({
          where: { id: input.connectionId, tenantId: input.tenantId },
          data: {
            status: 'DISCONNECTED',
            credentialRef: null,
            providerConfig: Prisma.DbNull,
            disconnectedAt: input.now,
            disconnectedByUserId: input.userId,
          },
        });
        const counts: DisconnectCounts = {
          credentialsDestroyed: credentials.count,
          consentsRevoked: consents.count,
          ownershipRevoked: ownership.count,
          auditsCancelled: audits.count,
          reviewsCancelled: reviews.count,
        };
        await tx.juryAuditEvent.create({
          data: {
            id: randomUUID(),
            tenantId: input.tenantId,
            timestamp: input.now,
            actor: input.userId,
            action: CONNECTION_DELETED_ACTION,
            serviceKey: input.serviceKey,
            accessMethod: input.accessMethod,
            source: 'jury-ui',
            provenance: { connectionId: input.connectionId, ...counts, screenshotsPending: input.screenshotsPending },
          },
        });
        return counts;
      }, JURY_INTERACTIVE_TRANSACTION);
    },
  };
}
