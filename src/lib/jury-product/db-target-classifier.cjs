/**
 * Shared, pure Supabase DB target classifier. No env reads, no IO, no network.
 * Used by scripts/build-db-target-policy.cjs (plain CommonJS build step) and by
 * preview-db-guard.ts (runtime / test guard) so both always reach the same verdict.
 *
 * Project refs are configuration, never source:
 *   JURY_PREVIEW_DB_PROJECT_REF       exactly one Preview project ref
 *   JURY_PRODUCTION_DB_PROJECT_REFS   comma-separated Production project refs
 *
 * Results are fixed classes only; no URL, username, password, or ref is returned.
 */
'use strict';

const PROJECT_REF = /^[a-z]{20}$/;
// Any Supabase shared-pooler region (aws-0-ap-south-1, aws-1-us-east-1, ...).
const POOLER_HOST = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/;
const DIRECT_PORTS = ['5432', '6543'];
// Shared pooler 6543 (transaction mode) is treated as UNVERIFIED and blocked. Reading the
// Preview ref from its username does not verify that mode's TLS chain or Prisma/pg
// compatibility; do not widen the allowed ports until that has been verified.
const POOLER_PORT = '5432';
// URL parameters that pg / libpq turn into their own TLS behaviour. Only
// sslmode=verify-full is tolerated (aligned with preview-db-tls.ts, plus sslaccept).
const SSL_URL_PARAMS = ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'sslaccept', 'uselibpqcompat'];

function validRefConfig(refs) {
  if (!refs || typeof refs.previewRef !== 'string' || !PROJECT_REF.test(refs.previewRef)) return false;
  if (!Array.isArray(refs.productionRefs) || refs.productionRefs.length === 0) return false;
  if (!refs.productionRefs.every((ref) => typeof ref === 'string' && PROJECT_REF.test(ref))) return false;
  return !refs.productionRefs.includes(refs.previewRef);
}

function readRefConfig(env) {
  const e = env || {};
  const previewRef = e.JURY_PREVIEW_DB_PROJECT_REF ?? '';
  const productionRefs = (e.JURY_PRODUCTION_DB_PROJECT_REFS ?? '').split(',').map((ref) => ref.trim());
  const refs = { previewRef, productionRefs };
  return validRefConfig(refs) ? refs : null;
}

/** Well-formed Production refs only, even when the rest of the config is invalid. */
function readProductionRefs(env) {
  const raw = (env || {}).JURY_PRODUCTION_DB_PROJECT_REFS;
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((ref) => ref.trim()).filter((ref) => PROJECT_REF.test(ref));
}

function parsePostgresUrl(value) {
  if (typeof value !== 'string') return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const scheme = url.protocol.slice(0, -1);
  if (scheme !== 'postgres' && scheme !== 'postgresql') return null;
  return url;
}

function userRef(url) {
  let user;
  try {
    user = decodeURIComponent(url.username);
  } catch {
    return null;
  }
  const match = /^postgres\.([a-z]{20})$/.exec(user);
  return match ? match[1] : null;
}

/** True when a Production ref appears anywhere in the value (raw or percent-decoded, any form). */
function mentionsRef(value, refs) {
  if (typeof value !== 'string' || refs.length === 0) return false;
  const forms = [value.toLowerCase()];
  try {
    forms.push(decodeURIComponent(value).toLowerCase());
  } catch {
    // undecodable as a whole: fall through to the per-escape form below
  }
  // Per-escape decode that never throws, so one invalid escape elsewhere in the value
  // cannot hide a percent-encoded Production ref (detection only; stricter, never looser).
  forms.push(value.replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).toLowerCase());
  return refs.some((ref) => forms.some((form) => form.includes(ref)));
}

function hasWeakSslParams(url) {
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (!SSL_URL_PARAMS.includes(lower)) continue;
    if (lower === 'sslmode' && url.searchParams.getAll(key).every((v) => v === 'verify-full')) continue;
    return true;
  }
  return false;
}

/**
 * Per-URL endpoint class (also used by the test-only guard and the CLI guard, whose
 * URLs legitimately carry CLI ssl params). 'production' wins; otherwise only a
 * verifiable Preview ref is 'allowed'. The stricter whole-env rules (Production ref
 * anywhere, ssl-weakening params) are applied in classifyDbTarget.
 */
function classifyConnectionUrl(value, refs) {
  if (!validRefConfig(refs)) return 'rejected';
  const url = parsePostgresUrl(value);
  if (!url) return 'rejected';
  const ref = userRef(url);
  for (const prod of refs.productionRefs) {
    if (url.hostname === `db.${prod}.supabase.co`) return 'production';
  }
  if (ref !== null && refs.productionRefs.includes(ref)) return 'production';
  if (url.port === '') return 'rejected';
  if (url.hostname === `db.${refs.previewRef}.supabase.co`) {
    if (!DIRECT_PORTS.includes(url.port)) return 'rejected';
    if (ref !== null && ref !== refs.previewRef) return 'rejected';
    return 'allowed';
  }
  if (POOLER_HOST.test(url.hostname)) {
    // Host alone never identifies the project: the username must carry the Preview ref.
    return url.port === POOLER_PORT && ref === refs.previewRef ? 'allowed' : 'rejected';
  }
  return 'rejected';
}

/**
 * Whole-environment verdict for a Preview build/runtime:
 *   'production' a Production ref appears in DATABASE_URL or DIRECT_URL (checked first)
 *   'config'     ref config invalid, JURY_PREVIEW_DB !== '1', or DATABASE_URL missing/blank
 *   'unverified' a present URL is not a verifiable Preview endpoint
 *   'ok'         DATABASE_URL (and DIRECT_URL when non-blank) are verified Preview endpoints
 */
function classifyDbTarget(env) {
  const e = env || {};
  const database = typeof e.DATABASE_URL === 'string' && e.DATABASE_URL.trim() !== '' ? e.DATABASE_URL : null;
  const direct = typeof e.DIRECT_URL === 'string' && e.DIRECT_URL.trim() !== '' ? e.DIRECT_URL : null;
  const present = [database, direct].filter((v) => v !== null);
  const productionRefs = readProductionRefs(e);
  if (present.some((v) => mentionsRef(v, productionRefs))) return 'production';
  const refs = readRefConfig(e);
  if (!refs || e.JURY_PREVIEW_DB !== '1' || database === null) return 'config';
  let verdict = 'ok';
  for (const value of present) {
    const c = classifyConnectionUrl(value, refs);
    if (c === 'production') return 'production';
    const url = parsePostgresUrl(value);
    if (c !== 'allowed' || !url || hasWeakSslParams(url)) verdict = 'unverified';
  }
  return verdict;
}

module.exports = {
  validRefConfig,
  readRefConfig,
  readProductionRefs,
  parsePostgresUrl,
  classifyConnectionUrl,
  classifyDbTarget,
};