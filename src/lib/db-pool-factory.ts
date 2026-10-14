import pg from 'pg';
import { isPreviewRuntime, requireRuntimeDbTarget, type RuntimeDbEnv } from './jury-product/preview-db-guard';
import { requirePreviewPgConfig, type PreviewPgSsl, type PreviewTlsDeps } from './jury-product/preview-db-tls';

/**
 * Builds the pg.Pool used by prisma.ts. In Preview mode (VERCEL_ENV=preview or
 * JURY_PREVIEW_DB=1) the DB target ref guard AND the pinned-CA/hostname TLS config
 * must both pass BEFORE the Pool constructor is called; otherwise a fixed status
 * (BLOCKED_PRODUCTION_DB / BLOCKED_PREVIEW_DB / BLOCKED_PREVIEW_TLS) is thrown and
 * no pool, socket, or connection is ever created. Outside Preview mode: unchanged.
 */
export type PoolCtor = new (config: pg.PoolConfig) => pg.Pool;
export type GuardedPoolDeps = { Pool?: PoolCtor; tls?: PreviewTlsDeps };

export function resolvePoolConnection(
  connectionString: string,
  env: RuntimeDbEnv,
  tls?: PreviewTlsDeps,
): { connectionString: string; ssl?: PreviewPgSsl } {
  if (!isPreviewRuntime(env)) return { connectionString };
  requireRuntimeDbTarget(env);
  const preview = requirePreviewPgConfig(connectionString, env, tls);
  return { connectionString: preview.connectionString, ssl: preview.ssl };
}

export function createGuardedPool(
  connectionString: string,
  env: RuntimeDbEnv,
  options: { max: number },
  deps: GuardedPoolDeps = {},
): pg.Pool {
  const target = resolvePoolConnection(connectionString, env, deps.tls);
  const Pool = deps.Pool ?? pg.Pool;
  return new Pool({
    connectionString: target.connectionString,
    ...(target.ssl ? { ssl: target.ssl } : {}),
    max: options.max,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
  });
}