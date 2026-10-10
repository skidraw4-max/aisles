import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { readValidCaPem } from './db-ca';

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

export function defaultPreviewCaPath(env: PreviewTlsEnv, home: string = os.homedir()): string {
  const configured = env.JURY_PREVIEW_DB_CA_PATH?.trim();
  return configured ? configured : path.join(home, '.postgresql', 'root.crt');
}

/**
 * Builds the pg config for a Preview connection. Fails closed when the CA is
 * missing, unreadable, not a valid CA, expired, or when the URL carries ssl
 * parameters. Only sslmode=verify-full is tolerated (stripped, the object governs).
 */
export function buildPreviewPgConfig(
  connectionString: string,
  env: PreviewTlsEnv,
  deps: { readFile?: (file: string) => string; home?: string } = {},
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
  const readFile = deps.readFile ?? ((file: string) => readFileSync(file, 'utf8'));
  const ca = readValidCaPem(defaultPreviewCaPath(env, deps.home), readFile);
  if (!ca) return blocked;
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
export function requirePreviewPgConfig(connectionString: string, env: PreviewTlsEnv): { connectionString: string; ssl: PreviewPgSsl } {
  const config = buildPreviewPgConfig(connectionString, env);
  if (!config.ok) throw new Error(config.status);
  return { connectionString: config.connectionString, ssl: config.ssl };
}
