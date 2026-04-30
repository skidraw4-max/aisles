/**
 * Vercel/CI 빌드: Supabase 풀러(DATABASE_URL :6543)에서는 migrate가 실패하는 경우가 많아
 * DIRECT_URL(직접 DB, 보통 :5432)이 있을 때만 `prisma migrate deploy` 실행.
 * @see https://www.prisma.io/docs/orm/overview/databases/supabase
 */
const { spawnSync } = require('child_process');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env, shell: true });
  return (r.status ?? 1) === 0;
}

const direct = process.env.DIRECT_URL?.trim();
if (direct) {
  console.log('[build] DIRECT_URL detected — running prisma migrate deploy');
  if (!run('npx', ['prisma', 'migrate', 'deploy'])) {
    process.exit(1);
  }
} else {
  console.warn(
    '[build] DIRECT_URL not set — skipping prisma migrate deploy. ' +
      'Add Supabase "Direct connection" URI (port 5432) as DIRECT_URL on Vercel to apply migrations on deploy.',
  );
}

if (!run('node', ['scripts/write-ads-txt.cjs'])) {
  process.exit(1);
}

if (!run('npx', ['next', 'build'])) {
  process.exit(1);
}
