/**
 * Build-time migration policy. Pure function: decides whether `run-build.cjs`
 * may run the migrate command. Returns only a boolean and a fixed reason code;
 * never returns or logs environment values.
 *
 * Production builds do NOT migrate by default. Migration on a production build
 * requires JURY_ALLOW_PROD_MIGRATE to equal PROD_MIGRATE_CONFIRMATION exactly
 * (no trimming, no case folding; '1' / 'true' do not count).
 *
 * Order:
 *   1. VERCEL missing/empty                          -> skip (LOCAL_SKIP)
 *   2. VERCEL_ENV !== 'production'                    -> skip (NON_PRODUCTION_SKIP)
 *   3. JURY_SKIP_MIGRATIONS === '1'                   -> skip (OPT_OUT, wins over the allow token)
 *   4. JURY_ALLOW_PROD_MIGRATE !== confirmation token -> skip (PRODUCTION_MIGRATE_NOT_ALLOWED)
 *   5. DIRECT_URL missing/whitespace                  -> skip (NO_DIRECT_URL)
 *   6. otherwise                                      -> run  (PRODUCTION_MIGRATE)
 */
'use strict';

const PROD_MIGRATE_CONFIRMATION = 'I_UNDERSTAND_PRODUCTION_MIGRATE';

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
  if (e.JURY_ALLOW_PROD_MIGRATE !== PROD_MIGRATE_CONFIRMATION) {
    return { run: false, reason: 'PRODUCTION_MIGRATE_NOT_ALLOWED' };
  }
  if (typeof e.DIRECT_URL !== 'string' || e.DIRECT_URL.trim() === '') {
    return { run: false, reason: 'NO_DIRECT_URL' };
  }
  return { run: true, reason: 'PRODUCTION_MIGRATE' };
}

module.exports = { decideMigrate, PROD_MIGRATE_CONFIRMATION };