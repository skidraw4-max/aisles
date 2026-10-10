/**
 * Preview integration tests must classify the database before any fixture write.
 * The returned status is safe to log. Connection strings are not included.
 */
export const PREVIEW_PROJECT_REF = 'gdigogpddwjiofwrcies';
export const PREVIEW_HOST_MARKER = 'aws-0-ap-south-1';

const PREVIEW_ENDPOINTS = [
  { hostname: 'db.gdigogpddwjiofwrcies.supabase.co', port: '5432' },
  { hostname: 'db.gdigogpddwjiofwrcies.supabase.co', port: '6543' },
  { hostname: 'aws-0-ap-south-1.pooler.supabase.com', port: '5432' },
] as const;
const PRODUCTION_DIRECT_HOSTNAME = 'db.pcvyoqbyhfbpevzkwpsf.supabase.co';

export type PreviewDbBlock = 'BLOCKED_PRODUCTION_DB' | 'BLOCKED_PREVIEW_DB';

export type PreviewDbEnv = {
  JURY_PREVIEW_DB?: string;
  DATABASE_URL?: string;
  DIRECT_URL?: string;
};

type ConnectionClass = 'allowed' | 'production' | 'rejected';

function classifyConnectionUrl(value: string): ConnectionClass {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'rejected';
  }
  const scheme = url.protocol.slice(0, -1);
  if (scheme !== 'postgres' && scheme !== 'postgresql') return 'rejected';
  if (url.hostname === PRODUCTION_DIRECT_HOSTNAME) return 'production';
  if (url.port === '') return 'rejected';
  const allowed = PREVIEW_ENDPOINTS.some((endpoint) => endpoint.hostname === url.hostname && endpoint.port === url.port);
  return allowed ? 'allowed' : 'rejected';
}

export function isKnownPreviewEndpoint(value: string | undefined): boolean {
  return classifyConnectionUrl(value ?? '') === 'allowed';
}

export function planPreviewDbAccess(
  env: PreviewDbEnv,
): { ok: true } | { ok: false; status: PreviewDbBlock } {
  const database = classifyConnectionUrl(env.DATABASE_URL ?? '');
  const direct = classifyConnectionUrl(env.DIRECT_URL ?? '');
  if (database === 'production' || direct === 'production') {
    return { ok: false, status: 'BLOCKED_PRODUCTION_DB' };
  }
  if (env.JURY_PREVIEW_DB !== '1' || database !== 'allowed' || direct !== 'allowed') {
    return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  }
  return { ok: true };
}

export function previewMigrationGate(failedCount: number): { ok: true } | { ok: false; status: 'BLOCKED_PREVIEW_DB' } {
  if (failedCount !== 0) return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  return { ok: true };
}

export async function openPreviewDbTest(
  env: PreviewDbEnv,
  readFailedMigrations: () => Promise<number>,
): Promise<{ ok: true } | { ok: false; status: PreviewDbBlock }> {
  const plan = planPreviewDbAccess(env);
  if (!plan.ok) return plan;
  let failed = 1;
  try {
    failed = await readFailedMigrations();
  } catch {
    return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  }
  return previewMigrationGate(failed);
}

export function selectExactTest(
  source: string,
  requestedName: string,
): { ok: true; pattern: string } | { ok: false; status: 'BLOCKED_PREVIEW_DB' } {
  if (!requestedName || /[|*+?()[\]\\]/.test(requestedName)) return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  const names = [...source.matchAll(/\btest\(\s*'([^']+)'/g)].map((match) => match[1] ?? '');
  if (names.filter((name) => name === requestedName).length !== 1) return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  return { ok: true, pattern: `^${requestedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` };
}

export function guardTestDatabase(env: NodeJS.ProcessEnv): void {
  if (!env.NODE_TEST_CONTEXT) return;
  const gate = planPreviewDbAccess({
    JURY_PREVIEW_DB: env.JURY_PREVIEW_DB,
    DATABASE_URL: env.DATABASE_URL,
    DIRECT_URL: env.DIRECT_URL,
  });
  if (!gate.ok) throw new Error(gate.status);
}
