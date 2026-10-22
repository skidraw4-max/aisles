/**
 * Build-time DB target policy. Pure: decides whether `run-build.cjs` may continue
 * (migration policy, next build) for this deployment's database settings.
 * Returns only a boolean and a fixed code; never returns or logs env values.
 *
 *   VERCEL_ENV === 'preview'     -> verify via the shared classifier (fail closed)
 *   VERCEL_ENV === 'production'  -> DB_TARGET_SKIPPED_PRODUCTION (unchanged behaviour)
 *   anything else (local, CI)    -> DB_TARGET_SKIPPED_LOCAL      (unchanged behaviour)
 *
 * Preview codes: DB_TARGET_OK, BLOCKED_DB_TARGET_PRODUCTION (checked first),
 * BLOCKED_DB_TARGET_CONFIG, BLOCKED_DB_TARGET_UNVERIFIED.
 */
'use strict';

const { classifyDbTarget, diagnoseDbTarget } = require('../src/lib/jury-product/db-target-classifier.cjs');

const PREVIEW_CODES = {
  ok: 'DB_TARGET_OK',
  production: 'BLOCKED_DB_TARGET_PRODUCTION',
  config: 'BLOCKED_DB_TARGET_CONFIG',
  unverified: 'BLOCKED_DB_TARGET_UNVERIFIED',
};

function decideDbTarget(env) {
  const e = env || {};
  if (e.VERCEL_ENV === 'preview') {
    let verdict;
    try {
      verdict = classifyDbTarget(e);
    } catch {
      verdict = 'unverified';
    }
    const code = PREVIEW_CODES[verdict] || PREVIEW_CODES.unverified;
    return { ok: code === PREVIEW_CODES.ok, code };
  }
  if (e.VERCEL_ENV === 'production') return { ok: true, code: 'DB_TARGET_SKIPPED_PRODUCTION' };
  return { ok: true, code: 'DB_TARGET_SKIPPED_LOCAL' };
}

// Diagnostic line whitelist (t86). Every printed token comes from these constants;
// nothing derived from env values is ever interpolated.
const DETAIL_FIELDS = [
  ['var', ['DATABASE_URL', 'DIRECT_URL']],
  ['present', [true, false]],
  ['parse', ['ok', 'invalid', 'bad_scheme', 'unavailable']],
  ['hostClass', ['direct_preview', 'shared_pooler', 'other', 'unavailable']],
  ['portClass', ['5432', '6543', 'none', 'other', 'unavailable']],
  ['userRefMatch', [true, false, 'unavailable']],
  ['prodRefMention', [true, false, 'unavailable']],
  ['sslPolicy', ['pass', 'fail', 'unavailable']],
  ['reason', ['OK', 'URL_MISSING', 'URL_PARSE_INVALID', 'BAD_SCHEME', 'HOST_OTHER', 'PORT_6543', 'PORT_MISSING', 'PORT_OTHER',
    'USER_REF_MISSING', 'SSL_PARAM', 'PRODUCTION_REF', 'UNVERIFIED_OTHER', 'DIAGNOSTIC_UNAVAILABLE']],
];
const DETAIL_VARS = DETAIL_FIELDS[0][1];
const DETAIL_PREFIX = '[build] db target detail:';

function fallbackDetail(index) {
  const vars = DETAIL_VARS[index];
  return `${DETAIL_PREFIX} var=${vars} present=unavailable parse=unavailable hostClass=unavailable portClass=unavailable userRefMatch=unavailable prodRefMention=unavailable sslPolicy=unavailable reason=DIAGNOSTIC_UNAVAILABLE`;
}

function formatDetail(entry, index) {
  const parts = [];
  for (const [field, allowed] of DETAIL_FIELDS) {
    const raw = entry && typeof entry === 'object' ? entry[field] : undefined;
    // Emit the constant from the whitelist (never the input object itself).
    const hit = allowed.find((a) => a === raw);
    let token = hit === undefined ? 'unavailable' : String(hit);
    if (field === 'var') token = DETAIL_VARS[index];
    else if (hit === undefined && field === 'reason') token = 'DIAGNOSTIC_UNAVAILABLE';
    parts.push(`${field}=${token}`);
  }
  return `${DETAIL_PREFIX} ${parts.join(' ')}`;
}

/**
 * Diagnostic lines for a blocked Vercel Preview build only (one per URL variable).
 * Returns [] for production/local/ok. Never throws; never affects decideDbTarget.
 * deps.diagnose is a test seam (defaults to the shared classifier's diagnoseDbTarget).
 */
function describeDbTargetBlock(env, deps) {
  try {
    const e = env || {};
    if (e.VERCEL_ENV !== 'preview') return [];
    const diagnose = (deps && deps.diagnose) || diagnoseDbTarget;
    let entries;
    try {
      entries = diagnose(e);
    } catch {
      entries = null;
    }
    return DETAIL_VARS.map((name, i) => {
      try {
        const entry = Array.isArray(entries) ? entries.find((x) => x && x.var === name) : null;
        return entry ? formatDetail(entry, i) : fallbackDetail(i);
      } catch {
        return fallbackDetail(i);
      }
    });
  } catch {
    return [];
  }
}

module.exports = { decideDbTarget, describeDbTargetBlock };