/**
 * Preview integration tests must classify the database before any fixture write.
 * The returned status is safe to log. Connection strings are not included.
 *
 * Project refs are not stored in source. They come from configuration:
 *   JURY_PREVIEW_DB_PROJECT_REF        exactly one Preview project ref
 *   JURY_PRODUCTION_DB_PROJECT_REFS    comma-separated Production project refs (at least one)
 * Missing, malformed, or overlapping configuration fails closed: nothing is allowed.
 */
export const PREVIEW_HOST_MARKER = 'aws-0-ap-south-1';
const PREVIEW_POOLER_HOSTNAME = `${PREVIEW_HOST_MARKER}.pooler.supabase.com`;
const PREVIEW_DIRECT_PORTS = ['5432', '6543'] as const;
const PREVIEW_POOLER_PORT = '5432';
const PROJECT_REF = /^[a-z]{20}$/;

export type PreviewDbBlock = 'BLOCKED_PRODUCTION_DB' | 'BLOCKED_PREVIEW_DB';

export type PreviewDbEnv = {
  JURY_PREVIEW_DB?: string;
  DATABASE_URL?: string;
  DIRECT_URL?: string;
  JURY_PREVIEW_DB_PROJECT_REF?: string;
  JURY_PRODUCTION_DB_PROJECT_REFS?: string;
};

export type PreviewDbRefConfig = {
  previewRef: string;
  productionRefs: readonly string[];
};

export function readPreviewDbRefConfig(
  env: Pick<PreviewDbEnv, 'JURY_PREVIEW_DB_PROJECT_REF' | 'JURY_PRODUCTION_DB_PROJECT_REFS'>,
): PreviewDbRefConfig | null {
  const previewRef = env.JURY_PREVIEW_DB_PROJECT_REF ?? '';
  const productionRefs = (env.JURY_PRODUCTION_DB_PROJECT_REFS ?? '').split(',').map((ref) => ref.trim());
  return validRefConfig({ previewRef, productionRefs }) ? { previewRef, productionRefs } : null;
}

function validRefConfig(refs: PreviewDbRefConfig | null | undefined): refs is PreviewDbRefConfig {
  if (!refs || !PROJECT_REF.test(refs.previewRef)) return false;
  if (refs.productionRefs.length === 0) return false;
  if (!refs.productionRefs.every((ref) => PROJECT_REF.test(ref))) return false;
  return !refs.productionRefs.includes(refs.previewRef);
}

type ConnectionClass = 'allowed' | 'production' | 'rejected';

function parsePostgresUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const scheme = url.protocol.slice(0, -1);
  if (scheme !== 'postgres' && scheme !== 'postgresql') return null;
  return url;
}

function poolerUserRef(url: URL): string | null {
  let user: string;
  try {
    user = decodeURIComponent(url.username);
  } catch {
    return null;
  }
  const match = /^postgres\.([a-z]{20})$/.exec(user);
  return match ? match[1] ?? null : null;
}

function classifyConnectionUrl(value: string, refs: PreviewDbRefConfig | null | undefined): ConnectionClass {
  if (!validRefConfig(refs)) return 'rejected';
  const url = parsePostgresUrl(value);
  if (!url) return 'rejected';
  const userRef = poolerUserRef(url);
  const isPooler = url.hostname === PREVIEW_POOLER_HOSTNAME;
  for (const ref of refs.productionRefs) {
    if (url.hostname === `db.${ref}.supabase.co`) return 'production';
    if (isPooler && userRef === ref) return 'production';
  }
  if (url.port === '') return 'rejected';
  if (url.hostname === `db.${refs.previewRef}.supabase.co`) {
    if (!(PREVIEW_DIRECT_PORTS as readonly string[]).includes(url.port)) return 'rejected';
    if (userRef !== null && userRef !== refs.previewRef) return 'rejected';
    return 'allowed';
  }
  if (isPooler) {
    return url.port === PREVIEW_POOLER_PORT && userRef === refs.previewRef ? 'allowed' : 'rejected';
  }
  return 'rejected';
}

export function isKnownPreviewEndpoint(value: string | undefined, refs?: PreviewDbRefConfig | null): boolean {
  return classifyConnectionUrl(value ?? '', refs) === 'allowed';
}

/** Structural check that needs no refs: a Supabase-hosted Postgres URL. Used to fail closed without config. */
export function isSupabaseHostedEndpoint(value: string | undefined): boolean {
  const url = parsePostgresUrl(value ?? '');
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return host.endsWith('.supabase.co') || host.endsWith('.supabase.com');
}

export function planPreviewDbAccess(
  env: PreviewDbEnv,
  refs: PreviewDbRefConfig | null = readPreviewDbRefConfig(env),
): { ok: true } | { ok: false; status: PreviewDbBlock } {
  const database = classifyConnectionUrl(env.DATABASE_URL ?? '', refs);
  const direct = classifyConnectionUrl(env.DIRECT_URL ?? '', refs);
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
  refs: PreviewDbRefConfig | null = readPreviewDbRefConfig(env),
): Promise<{ ok: true } | { ok: false; status: PreviewDbBlock }> {
  const plan = planPreviewDbAccess(env, refs);
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
    JURY_PREVIEW_DB_PROJECT_REF: env.JURY_PREVIEW_DB_PROJECT_REF,
    JURY_PRODUCTION_DB_PROJECT_REFS: env.JURY_PRODUCTION_DB_PROJECT_REFS,
  });
  if (!gate.ok) throw new Error(gate.status);
}
