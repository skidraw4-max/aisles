/**
 * Build-time migration policy. Pure function: decides whether `run-build.cjs`
 * may run the migrate command. Returns only a boolean and a fixed reason code;
 * never returns or logs environment values.
 *
 * Order:
 *   1. VERCEL missing/empty            -> skip (LOCAL_SKIP)
 *   2. VERCEL_ENV !== 'production'      -> skip (NON_PRODUCTION_SKIP)
 *   3. JURY_SKIP_MIGRATIONS === '1'     -> skip (OPT_OUT)
 *   4. DIRECT_URL missing/whitespace    -> skip (NO_DIRECT_URL)
 *   5. otherwise                        -> run  (PRODUCTION_MIGRATE)
 */
'use strict';

function decideMigrate(env) {
  const e = env || {};
  if (typeof e.VERCEL !== 'string' || e.VERCEL === '') {
    return { run: false, reason: 'LOCAL_SKIP' };
  }
  if (e.VERCEL_ENV !== 'production') {
    return { run: false, reason: 'NON_PRODUCTION_SKIP' };
  }
  if (e.JURY_SKIP_MIGRATIONS === '1') {
    return { run: false, reason: 'OPT_OUT' };
  }
  if (typeof e.DIRECT_URL !== 'string' || e.DIRECT_URL.trim() === '') {
    return { run: false, reason: 'NO_DIRECT_URL' };
  }
  return { run: true, reason: 'PRODUCTION_MIGRATE' };
}

module.exports = { decideMigrate };