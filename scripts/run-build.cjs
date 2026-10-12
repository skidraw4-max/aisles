/**
 * Vercel/CI build. Order:
 *   1. DB target policy (scripts/build-db-target-policy.cjs): on Vercel Preview the
 *      DATABASE_URL / DIRECT_URL must name the configured Preview Supabase project ref,
 *      otherwise the build stops here (exit 1) before any migration or next build.
 *      Only a fixed code is logged. Production and local builds are unchanged.
 *   2. Migration policy (scripts/build-migrate-policy.cjs): `prisma migrate deploy`
 *      is skipped by default, including on Vercel production. It runs only on Vercel
 *      production with the exact JURY_ALLOW_PROD_MIGRATE confirmation token, a non-blank
 *      DIRECT_URL, and without JURY_SKIP_MIGRATIONS=1. Local and Preview builds skip it.
 *   3. Client boundary check, ads.txt, next build.
 * @see https://www.prisma.io/docs/orm/overview/databases/supabase
 */
const { spawnSync } = require('child_process');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env, shell: true });
  return (r.status ?? 1) === 0;
}

const { decideDbTarget, describeDbTargetBlock } = require('./build-db-target-policy.cjs');
const { decideMigrate } = require('./build-migrate-policy.cjs');

// 1. DB target check first: nothing below (migrate, next build) runs on a blocked target.
const target = decideDbTarget(process.env);
console.log(`[build] db target: ${target.code}`);
if (!target.ok) {
  // Diagnostics only (Preview block): fixed enums per URL; failures here never change the exit.
  try {
    for (const line of describeDbTargetBlock(process.env)) console.log(line);
  } catch {
    // ignore
  }
  process.exit(1);
}

// 1b. Supabase API target (Preview only): URL/keys must name the Preview project, never Production.
//     Non-preview builds skip silently so Production output is unchanged. Only a fixed code is logged.
const { isPreviewScope, checkSupabaseTarget } = require('../src/lib/jury-product/supabase-target-guard.cjs');
if (isPreviewScope(process.env)) {
  const sb = checkSupabaseTarget(process.env, { checkServiceKeyIfPresent: true });
  console.log(`[build] supabase target: ${sb.code}`);
  if (!sb.ok) process.exit(1);
}

const decision = decideMigrate(process.env);
if (decision.run) {
  console.log(`[build] migrate policy: ${decision.reason}`);
  if (!run('npx', ['prisma', 'migrate', 'deploy'])) {
    process.exit(1);
  }
} else {
  console.log(`[build] migrate policy: ${decision.reason} (skipped)`);
}

if (!run('node', ['scripts/check-no-prisma-in-client.cjs'])) {
  process.exit(1);
}

if (!run('node', ['scripts/write-ads-txt.cjs'])) {
  process.exit(1);
}

if (!run('npx', ['next', 'build'])) {
  process.exit(1);
}
