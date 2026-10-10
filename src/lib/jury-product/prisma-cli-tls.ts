import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readValidCaPem } from './db-ca';
import { planPreviewDbAccess } from './preview-db-guard';

/**
 * TLS policy for the Prisma CLI (migrate / db push / db seed / studio).
 *
 * The CLI does not use src/lib/prisma.ts: Prisma 7.6 has no driver-adapter option in
 * prisma.config.ts, so the schema engine connects with URL parameters only
 * (sslmode, sslcert = server root certificate path). The runtime pg path uses
 * different semantics for the same names, so CLI urls live in their own variable
 * (PRISMA_CLI_DATABASE_URL) and are never read by the runtime.
 *
 * Switch: JURY_DB_CLI_TLS=verify (or JURY_PREVIEW_DB=1) turns this policy on.
 * When on there is no fallback to DIRECT_URL / DATABASE_URL and any problem throws
 * a fixed code before the CLI connects. When off and not in Preview mode the
 * previous selection (DIRECT_URL || DATABASE_URL) is kept; PRISMA_CLI_DATABASE_URL
 * only takes priority when it is set.
 *
 * Engine verification is NOT confirmed: whether sslmode=require + sslcert makes the
 * installed schema engine verify the chain AND the hostname could not be confirmed
 * from the installed package. Until it is confirmed by a separately approved Preview
 * check, a fully valid url still yields UNVERIFIED_CLI_TLS and is blocked.
 */
export const CLI_ENGINE_TLS_VERIFICATION_CONFIRMED = false;

export type CliTlsReason =
  | 'SWITCH_INVALID'
  | 'URL_MISSING'
  | 'URL_INVALID'
  | 'SSL_PARAM'
  | 'SSLMODE'
  | 'CA_PATH'
  | 'CA_INVALID'
  | 'PREVIEW_GUARD'
  | 'UNVERIFIED_CLI_TLS';

export type CliTlsResult = { ok: true } | { ok: false; reason: CliTlsReason };

export type CliTlsEnv = {
  PRISMA_CLI_DATABASE_URL?: string;
  DIRECT_URL?: string;
  DATABASE_URL?: string;
  JURY_DB_CLI_TLS?: string;
  JURY_DB_CA_PATH?: string;
  JURY_PREVIEW_DB?: string;
  JURY_PREVIEW_DB_PROJECT_REF?: string;
  JURY_PRODUCTION_DB_PROJECT_REFS?: string;
  [key: string]: string | undefined;
};

export type CliTlsDeps = {
  readFile?: (file: string) => string;
  now?: () => number;
  engineVerificationConfirmed?: boolean;
};

// Only these parameters may appear on an enforced CLI url. Everything else
// (sslaccept, sslidentity, sslpassword, sslrootcert, ssl, pgbouncer, ...) is refused.
const ALLOWED_PARAMS = new Set(['sslmode', 'sslcert', 'schema', 'connect_timeout', 'application_name']);

function isAbsolutePath(value: string): boolean {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

export function validateCliDatabaseUrl(value: string, caPath: string | undefined, deps: CliTlsDeps = {}): CliTlsResult {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'URL_INVALID' };
  }
  const scheme = url.protocol.slice(0, -1);
  if (scheme !== 'postgres' && scheme !== 'postgresql') return { ok: false, reason: 'URL_INVALID' };
  if (!url.hostname) return { ok: false, reason: 'URL_INVALID' };
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return { ok: false, reason: 'SSL_PARAM' };
  for (const key of keys) {
    if (!ALLOWED_PARAMS.has(key)) return { ok: false, reason: 'SSL_PARAM' };
  }
  if (url.searchParams.get('sslmode') !== 'require') return { ok: false, reason: 'SSLMODE' };
  const configured = caPath?.trim() ?? '';
  if (!configured || !isAbsolutePath(configured)) return { ok: false, reason: 'CA_PATH' };
  if (url.searchParams.get('sslcert') !== configured) return { ok: false, reason: 'CA_PATH' };
  const readFile = deps.readFile ?? ((file: string) => readFileSync(file, 'utf8'));
  if (!readValidCaPem(configured, readFile, deps.now)) return { ok: false, reason: 'CA_INVALID' };
  const confirmed = deps.engineVerificationConfirmed ?? CLI_ENGINE_TLS_VERIFICATION_CONFIRMED;
  if (!confirmed) return { ok: false, reason: 'UNVERIFIED_CLI_TLS' };
  return { ok: true };
}

// Prisma CLI argv is [node, prisma, <command>, ...]. Only an exact leading 'generate' is exempt.
function cliCommand(argv: readonly string[]): string | undefined {
  return argv[2];
}

/**
 * Datasource url for prisma.config.ts. Throws `BLOCKED_CLI_TLS:<reason>` (no url, path,
 * or certificate content) when the policy is on and the url cannot be accepted.
 * `prisma generate` never connects, so under the policy it gets no url at all.
 */
export function resolveCliDatasourceUrl(
  env: CliTlsEnv,
  argv: readonly string[] = [],
  deps: CliTlsDeps = {},
): string | undefined {
  const switchValue = env.JURY_DB_CLI_TLS ?? '';
  if (switchValue !== '' && switchValue !== 'verify') throw new Error('BLOCKED_CLI_TLS:SWITCH_INVALID');
  const enforced = switchValue === 'verify' || env.JURY_PREVIEW_DB === '1';
  if (!enforced) return env.PRISMA_CLI_DATABASE_URL || env.DIRECT_URL || env.DATABASE_URL;
  if (cliCommand(argv) === 'generate') return undefined;
  const url = env.PRISMA_CLI_DATABASE_URL ?? '';
  if (!url) throw new Error('BLOCKED_CLI_TLS:URL_MISSING');
  if (env.JURY_PREVIEW_DB === '1') {
    const plan = planPreviewDbAccess({
      JURY_PREVIEW_DB: '1',
      DATABASE_URL: url,
      DIRECT_URL: url,
      JURY_PREVIEW_DB_PROJECT_REF: env.JURY_PREVIEW_DB_PROJECT_REF,
      JURY_PRODUCTION_DB_PROJECT_REFS: env.JURY_PRODUCTION_DB_PROJECT_REFS,
    });
    if (!plan.ok) throw new Error('BLOCKED_CLI_TLS:PREVIEW_GUARD');
  }
  const result = validateCliDatabaseUrl(url, env.JURY_DB_CA_PATH, deps);
  if (!result.ok) throw new Error(`BLOCKED_CLI_TLS:${result.reason}`);
  return url;
}
