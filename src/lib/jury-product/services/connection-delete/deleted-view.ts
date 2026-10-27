/** I-080: deleted-connections view helpers (UI-only; no schema change). */
import { maskJuryEmail } from '../../jury-signup';

export type DeletedConnectionMeta = { disconnectedAt: string | null; deletedBy: string };

export function countConnectionRows(rows: readonly { connectionStatus: string }[]): { active: number; deleted: number } {
  let deleted = 0;
  for (const row of rows) if (row.connectionStatus === 'DISCONNECTED') deleted += 1;
  return { active: rows.length - deleted, deleted };
}

/** Public handle first, else masked email. Never the raw email. */
export function deletedByLabel(user: { username?: string | null; email?: string | null } | null | undefined): string {
  if (!user) return '—';
  if (user.username && user.username.trim()) return user.username.trim();
  if (user.email) return maskJuryEmail(user.email);
  return '—';
}

export const DELETED_VIEW_NOTICE = '삭제된 연결을 보고 있어요. 계정 정보와 스크린샷은 지워졌고, 심사 결과만 남아 있어요.';
export const DELETED_VIEW_TITLE = '서비스 연결 · 삭제됨';
export const DELETED_VIEW_EMPTY = '삭제된 연결이 없어요.';

/** Tenant-scoped read of deletion time + actor label for DISCONNECTED connections. */
export async function loadDeletedConnectionMeta(tenantId: string): Promise<Record<string, DeletedConnectionMeta>> {
  const { prisma } = await import('@/lib/prisma');
  const rows = await prisma.juryServiceConnection.findMany({
    where: { tenantId, status: 'DISCONNECTED' },
    select: { id: true, disconnectedAt: true, disconnectedByUserId: true },
  });
  const userIds = [...new Set(rows.map((r) => r.disconnectedByUserId).filter((v): v is string => Boolean(v)))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, email: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const out: Record<string, DeletedConnectionMeta> = {};
  for (const r of rows) {
    out[r.id] = {
      disconnectedAt: r.disconnectedAt ? r.disconnectedAt.toISOString() : null,
      deletedBy: r.disconnectedByUserId ? deletedByLabel(byId.get(r.disconnectedByUserId)) : '—',
    };
  }
  return out;
}
