/**
 * Preview integration tests must classify the database before any fixture write.
 * The returned status is safe to log. Connection strings are not included.
 *
 * Project refs are not stored in source. They come from configuration:
 *   JURY_PREVIEW_DB_PROJECT_REF        exactly one Preview project ref
 *   JURY_PRODUCTION_DB_PROJECT_REFS    comma-separated Production project refs (at least one)
 * Missing, malformed, or overlapping configuration fails closed: nothing is allowed.
 *
 * URL classification lives in db-target-classifier.cjs, shared with the build-time
 * policy (scripts/build-db-target-policy.cjs) so build and runtime cannot drift.
 */
import {
  classifyConnectionUrl,
  classifyDbTarget,
  parsePostgresUrl,
  readRefConfig,
  type DbTargetEnv,
} from './db-target-classifier.cjs';

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
  return readRefConfig(env);
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

export type RuntimeDbEnv = DbTargetEnv;

/** Real Preview deployment (Vercel) or an explicit Preview DB session. */
export function isPreviewRuntime(env: RuntimeDbEnv): boolean {
  return env.VERCEL_ENV === 'preview' || env.JURY_PREVIEW_DB === '1';
}

/**
 * Non-test runtime target check (shared classifier). Requires JURY_PREVIEW_DB=1,
 * valid ref config, a verified Preview DATABASE_URL and, when non-blank, DIRECT_URL.
 * A Production ref anywhere wins and yields BLOCKED_PRODUCTION_DB.
 */
export function planRuntimeDbTarget(env: RuntimeDbEnv): { ok: true } | { ok: false; status: PreviewDbBlock } {
  let verdict: string;
  try {
    verdict = classifyDbTarget(env);
  } catch {
    verdict = 'unverified';
  }
  if (verdict === 'production') return { ok: false, status: 'BLOCKED_PRODUCTION_DB' };
  if (verdict !== 'ok') return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  return { ok: true };
}

/** Throws a fixed status (never a URL or ref) in Preview mode when the target is not verified. */
export function requireRuntimeDbTarget(env: RuntimeDbEnv): void {
  if (!isPreviewRuntime(env)) return;
  const gate = planRuntimeDbTarget(env);
  if (!gate.ok) throw new Error(gate.status);
}
