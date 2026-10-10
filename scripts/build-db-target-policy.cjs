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

const { classifyDbTarget } = require('../src/lib/jury-product/db-target-classifier.cjs');

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

module.exports = { decideDbTarget };