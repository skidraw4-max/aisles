import { readFileSync } from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { readPinnedCaPem } from './db-ca';
import { SUPABASE_CA_RELATIVE_PATH, type CaPin } from './supabase-ca-pin';

/**
 * TLS for Preview DB connections (pg / Prisma driver adapter).
 * The connection must verify the server chain against the Supabase root CA and
 * the hostname. There is no plaintext or unverified fallback.
 * The guard (preview-db-guard.ts) still decides WHICH database is allowed; this
 * module only decides HOW a Preview connection is secured.
 * The returned status is safe to log: no URL, path, or certificate content.
 */
export type PreviewTlsBlock = 'BLOCKED_PREVIEW_TLS';

export type PreviewTlsEnv = {
  JURY_PREVIEW_DB_CA_PATH?: string;
  [key: string]: string | undefined;
};

export type PreviewPgSsl = {
  ca: string;
  rejectUnauthorized: true;
  servername: string;
  checkServerIdentity: typeof tls.checkServerIdentity;
};

export type PreviewPgConfig =
  | { ok: true; connectionString: string; ssl: PreviewPgSsl }
  | { ok: false; status: PreviewTlsBlock };

// URL parameters that pg-connection-string turns into its own ssl config. They would
// override or weaken the ssl object, so a Preview URL must not carry them.
const SSL_URL_PARAMS = ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'uselibpqcompat'];

function isAbsolutePath(value: string): boolean {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

/**
 * CA location for Preview connections. Default: the committed, pinned Supabase CA
 * under the project directory (cwd). JURY_PREVIEW_DB_CA_PATH may override it, but
 * only with an absolute path; a relative override returns null (fail closed).
 */
export function defaultPreviewCaPath(env: PreviewTlsEnv, cwd: string = process.cwd()): string | null {
  const configured = env.JURY_PREVIEW_DB_CA_PATH?.trim();
  if (!configured) return path.join(cwd, SUPABASE_CA_RELATIVE_PATH);
  return isAbsolutePath(configured) ? configured : null;
}

/**
 * Code-level dependencies (never read from env).
 * - cwd: project directory used for the default CA path.
 * - readFile: byte reader for the CA file.
 * - pin: TEST-ONLY. Lets unit tests pin a locally generated test CA so the same
 *   pinned-validation path can drive local TLS handshake tests. Production callers
 *   never pass it, so the committed Supabase pin always applies.
 */
export type PreviewTlsDeps = { cwd?: string; readFile?: (file: string) => Buffer; pin?: CaPin; now?: () => number };

/**
 * Builds the pg config for a Preview connection. Fails closed when the CA is
 * missing, unreadable, does not match the pinned CA, expired, the override path is
 * relative, or when the URL carries ssl
 * parameters. Only sslmode=verify-full is tolerated (stripped, the object governs).
 */
export function buildPreviewPgConfig(
  connectionString: string,
  env: PreviewTlsEnv,
  deps: PreviewTlsDeps = {},
): PreviewPgConfig {
  const blocked: PreviewPgConfig = { ok: false, status: 'BLOCKED_PREVIEW_TLS' };
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return blocked;
  }
  const scheme = url.protocol.slice(0, -1);
  if (scheme !== 'postgres' && scheme !== 'postgresql') return blocked;
  if (!url.hostname) return blocked;
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (!SSL_URL_PARAMS.includes(lower)) continue;
    if (lower === 'sslmode' && url.searchParams.getAll(key).every((value) => value === 'verify-full')) {
      url.searchParams.delete(key);
      continue;
    }
    return blocked;
  }
  const caPath = defaultPreviewCaPath(env, deps.cwd);
  if (!caPath) return blocked;
  let ca: string;
  try {
    // Pinned: exact file bytes, DER fingerprint, subject/issuer, CA flag, validity.
    ca = readPinnedCaPem(caPath, {
      pin: deps.pin,
      now: deps.now,
      fs: { readFileSync: deps.readFile ?? ((file: string) => readFileSync(file)) },
    });
  } catch {
    // PinnedCaError codes are dropped on purpose: one fixed status, no path or PEM.
    return blocked;
  }
  return {
    ok: true,
    connectionString: url.toString(),
    ssl: {
      ca,
      rejectUnauthorized: true,
      servername: url.hostname,
      checkServerIdentity: tls.checkServerIdentity,
    },
  };
}

/** Throws a fixed status (never the URL) when a Preview connection cannot be secured. */
export function requirePreviewPgConfig(
  connectionString: string,
  env: PreviewTlsEnv,
  deps: PreviewTlsDeps = {},
): { connectionString: string; ssl: PreviewPgSsl } {
  const config = buildPreviewPgConfig(connectionString, env, deps);
  if (!config.ok) throw new Error(config.status);
  return { connectionString: config.connectionString, ssl: config.ssl };
}
