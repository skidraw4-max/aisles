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

const { decideMigrate } = require('./build-migrate-policy.cjs');

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
