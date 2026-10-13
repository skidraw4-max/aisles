/**
 * Vercel/CI build. Order:
 *   1. DB target policy (scripts/build-db-target-policy.cjs): on Vercel Preview the
 *      DATABASE_URL / DIRECT_URL must name the configured Preview Supabase project ref,
 *      otherwise the build stops here (exit 1) before next build.
 *      Only a fixed code is logged. Production and local builds are unchanged.
 *   2. Database migrations never run during the build, for any input. Only the fixed
 *      status line BUILD_MIGRATE_DISABLED is logged. Migrations are a separate,
 *      separately approved operation outside the build.
 *   3. Client boundary check, ads.txt, next build.
 * @see https://www.prisma.io/docs/orm/overview/databases/supabase
 */
const { spawnSync } = require('child_process');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env, shell: true });
  return (r.status ?? 1) === 0;
}

const { decideDbTarget, describeDbTargetBlock } = require('./build-db-target-policy.cjs');

// 1. DB target check first: nothing below (status line, next build) runs on a blocked target.
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

// 2. Migrations never run in the build; only a fixed status line is logged (after the blocks above).
console.log('[build] migrate policy: BUILD_MIGRATE_DISABLED (skipped)');

if (!run('node', ['scripts/check-no-prisma-in-client.cjs'])) {
  process.exit(1);
}

if (!run('node', ['scripts/write-ads-txt.cjs'])) {
  process.exit(1);
}

if (!run('npx', ['next', 'build'])) {
  process.exit(1);
}
