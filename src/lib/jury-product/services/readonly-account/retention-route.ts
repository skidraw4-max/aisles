/** I-043: framework-free handler for the purge cron route (testable without Next or a DB). */
import { timingSafeEqual } from 'node:crypto';
import { purgeExpiredCredentials, type RetentionStore } from './retention';

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function handleReadonlyAccountPurge(
  authorization: string | null,
  deps: { secret: string | undefined; enabled: boolean; loadStore: () => Promise<RetentionStore>; now: () => Date },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = deps.secret?.trim();
  if (!secret || !authorization || !sameSecret(authorization.trim(), `Bearer ${secret}`)) return { status: 401, body: { ok: false, error: 'UNAUTHORIZED' } };
  if (!deps.enabled) return { status: 200, body: { ok: true, skipped: 'DISABLED' } };
  try {
    const result = await purgeExpiredCredentials(await deps.loadStore(), deps.now());
    return { status: 200, body: { ok: true, ...result } };
  } catch {
    return { status: 500, body: { ok: false, error: 'PURGE_FAILED' } };
  }
}
