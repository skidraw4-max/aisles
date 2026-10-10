import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  isKnownPreviewEndpoint,
  openPreviewDbTest,
  planPreviewDbAccess,
  selectExactTest,
} from './preview-db-guard';

const direct = 'postgres://user:secret@db.gdigogpddwjiofwrcies.supabase.co:5432/postgres';
const transaction = 'postgresql://user:secret@db.gdigogpddwjiofwrcies.supabase.co:6543/postgres';
const session = 'postgres://user:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
const productionDirect = 'postgres://user:secret@db.pcvyoqbyhfbpevzkwpsf.supabase.co:5432/postgres';

function calls() {
  return { migration: 0 };
}

function assertBlockedPreview(status: { ok: boolean; status?: string }) {
  assert.equal(status.ok, false);
  if (!status.ok) assert.equal(status.status, 'BLOCKED_PREVIEW_DB');
  assert.equal(JSON.stringify(status).includes('secret'), false);
  assert.equal(JSON.stringify(status).includes('postgres://'), false);
}

test('preview db guard allows each confirmed hostname and port', async () => {
  for (const url of [direct, transaction, session]) {
    const seen = calls();
    const opened = await openPreviewDbTest({
      JURY_PREVIEW_DB: '1',
      DATABASE_URL: url,
      DIRECT_URL: url,
    }, async () => {
      seen.migration += 1;
      return 0;
    });
    assert.equal(opened.ok, true);
    assert.equal(seen.migration, 1);
  }
  const mixed = planPreviewDbAccess({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: direct,
    DIRECT_URL: session,
  });
  assert.equal(mixed.ok, true);
});

test('preview db guard blocks a production direct hostname before fixture work', async () => {
  const seen = calls();
  const blocked = await openPreviewDbTest({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: productionDirect,
    DIRECT_URL: productionDirect,
  }, async () => {
    seen.migration += 1;
    return 0;
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.status, 'BLOCKED_PRODUCTION_DB');
  assert.equal(seen.migration, 0);
  assert.equal(JSON.stringify(blocked).includes('secret'), false);
  assert.equal(JSON.stringify(blocked).includes('postgres://'), false);
});

test('preview db guard rejects hosts, ports, and url parts outside the allowlist', async () => {
  const seen = calls();
  const cases = [
    { DATABASE_URL: 'postgres://user:secret@db.other-project.supabase.co:5432/postgres', DIRECT_URL: direct },
    { DATABASE_URL: 'postgres://user:secret@db.gdigogpddwjiofwrcies.supabase.co:5433/postgres', DIRECT_URL: direct },
    { DATABASE_URL: 'postgres://user:secret@db.gdigogpddwjiofwrcies.supabase.co/postgres', DIRECT_URL: direct },
    { DATABASE_URL: 'not a url', DIRECT_URL: direct },
    { DATABASE_URL: 'mysql://user:secret@db.gdigogpddwjiofwrcies.supabase.co:5432/postgres', DIRECT_URL: direct },
    { DATABASE_URL: 'postgres://db.gdigogpddwjiofwrcies.supabase.co:secret@evil.example:5432/postgres', DIRECT_URL: direct },
    { DATABASE_URL: 'postgres://user:aws-0-ap-south-1.pooler.supabase.com@evil.example:5432/postgres', DIRECT_URL: direct },
    { DATABASE_URL: 'postgres://user:secret@evil.example:5432/db.gdigogpddwjiofwrcies.supabase.co', DIRECT_URL: direct },
    { DATABASE_URL: 'postgres://user:secret@evil.example:5432/postgres?host=db.gdigogpddwjiofwrcies.supabase.co', DIRECT_URL: direct },
    { DATABASE_URL: direct },
    { DIRECT_URL: direct, JURY_PREVIEW_DB: '1' },
    { JURY_PREVIEW_DB: '1', DATABASE_URL: session, DIRECT_URL: 'postgres://user:secret@aws-1-ap-south-1.pcvyoqbyhfbpevzkwpsf.example/postgres' },
  ];
  for (const env of cases) {
    const blocked = await openPreviewDbTest({
      JURY_PREVIEW_DB: '1',
      ...env,
    }, async () => {
      seen.migration += 1;
      return 0;
    });
    assertBlockedPreview(blocked);
  }
  assert.equal(seen.migration, 0);

  const inactive = planPreviewDbAccess({
    DATABASE_URL: direct,
    DIRECT_URL: session,
  });
  assertBlockedPreview(inactive);

  const dirty = await openPreviewDbTest({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: direct,
    DIRECT_URL: transaction,
  }, async () => 2);
  assertBlockedPreview(dirty);
});

function assertBlockedProduction(status: { ok: boolean; status?: string }) {
  assert.equal(status.ok, false);
  if (!status.ok) assert.equal(status.status, 'BLOCKED_PRODUCTION_DB');
  assert.equal(JSON.stringify(status).includes('secret'), false);
  assert.equal(JSON.stringify(status).includes('postgres://'), false);
}

test('one production direct hostname blocks even when the other url is allowed', async () => {
  const cases = [
    { DATABASE_URL: productionDirect, DIRECT_URL: session },
    { DATABASE_URL: session, DIRECT_URL: productionDirect },
  ];
  for (const env of cases) {
    const seen = calls();
    const blocked = await openPreviewDbTest({
      JURY_PREVIEW_DB: '1',
      ...env,
    }, async () => {
      seen.migration += 1;
      return 0;
    });
    assertBlockedProduction(blocked);
    assert.equal(seen.migration, 0);
  }
});

test('hostname boundaries stay outside the allowlist', () => {
  const allowedHost = 'db.gdigogpddwjiofwrcies.supabase.co';
  const sessionHost = 'aws-0-ap-south-1.pooler.supabase.com';
  const productionHost = 'db.pcvyoqbyhfbpevzkwpsf.supabase.co';
  const cases = [
    `postgres://user:secret@${allowedHost.toUpperCase()}:5432/postgres`,
    `postgres://user:secret@${allowedHost}.:5432/postgres`,
    'postgres://user:secret@db%2egdigogpddwjiofwrcies.supabase.co:5432/postgres',
    `postgres://user:secret@${allowedHost}.evil.example:5432/postgres`,
    `postgres://${allowedHost}:secret@evil.example:5432/postgres`,
    `postgres://user:${sessionHost}@evil.example:5432/postgres`,
    `postgres://user:secret@evil.example:5432/${allowedHost}`,
    `postgres://user:secret@evil.example:5432/postgres?host=${allowedHost}`,
    `postgres://user:secret@${productionHost.toUpperCase()}:5432/postgres`,
  ];
  for (const databaseUrl of cases) {
    const blocked = planPreviewDbAccess({
      JURY_PREVIEW_DB: '1',
      DATABASE_URL: databaseUrl,
      DIRECT_URL: session,
    });
    assertBlockedPreview(blocked);
  }
});

test('port boundaries follow the current parser without enlarging the allowlist', () => {
  const missing = planPreviewDbAccess({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: 'postgres://user:secret@db.gdigogpddwjiofwrcies.supabase.co/postgres',
    DIRECT_URL: session,
  });
  assertBlockedPreview(missing);

  const otherPort = planPreviewDbAccess({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: 'postgres://user:secret@db.gdigogpddwjiofwrcies.supabase.co:5433/postgres',
    DIRECT_URL: session,
  });
  assertBlockedPreview(otherPort);

  const paddedDirect = planPreviewDbAccess({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: 'postgres://user:secret@db.gdigogpddwjiofwrcies.supabase.co:05432/postgres',
    DIRECT_URL: session,
  });
  assert.equal(paddedDirect.ok, true);

  for (const url of [direct, transaction, session]) {
    const allowed = planPreviewDbAccess({
      JURY_PREVIEW_DB: '1',
      DATABASE_URL: url,
      DIRECT_URL: url,
    });
    assert.equal(allowed.ok, true);
  }
});

test('known preview endpoint detection follows the current hostname and port parser', () => {
  assert.equal(isKnownPreviewEndpoint(direct), true);
  assert.equal(isKnownPreviewEndpoint(transaction), true);
  assert.equal(isKnownPreviewEndpoint(session), true);
  assert.equal(isKnownPreviewEndpoint('postgres://user:secret@db.gdigogpddwjiofwrcies.supabase.co:05432/postgres'), true);
  assert.equal(isKnownPreviewEndpoint('postgres://user:secret@db.gdigogpddwjiofwrcies.supabase.co/postgres'), false);
  assert.equal(isKnownPreviewEndpoint('postgres://user:secret@db.gdigogpddwjiofwrcies.supabase.co:5433/postgres'), false);
  assert.equal(isKnownPreviewEndpoint('not a url'), false);
  assert.equal(isKnownPreviewEndpoint(''), false);
  assert.equal(isKnownPreviewEndpoint(undefined), false);
  assert.equal(isKnownPreviewEndpoint(productionDirect), false);
  assert.equal(isKnownPreviewEndpoint('postgres://user:secret@ordinary.example:5432/postgres'), false);
  assert.equal(isKnownPreviewEndpoint('postgres://db.gdigogpddwjiofwrcies.supabase.co:secret@evil.example:5432/postgres'), false);
  assert.equal(isKnownPreviewEndpoint('postgres://user:aws-0-ap-south-1.pooler.supabase.com@evil.example:5432/postgres'), false);
  assert.equal(isKnownPreviewEndpoint('postgres://user:secret@evil.example:5432/db.gdigogpddwjiofwrcies.supabase.co'), false);
  assert.equal(isKnownPreviewEndpoint('postgres://user:secret@evil.example:5432/postgres?host=db.gdigogpddwjiofwrcies.supabase.co'), false);
  assert.equal(isKnownPreviewEndpoint(`postgres://user:secret@${'db.gdigogpddwjiofwrcies.supabase.co'.toUpperCase()}:5432/postgres`), false);
});

test('the classifier accepts only the exact preview flag', () => {
  const urls = { DATABASE_URL: direct, DIRECT_URL: session };
  assert.equal(planPreviewDbAccess({ JURY_PREVIEW_DB: '1', ...urls }).ok, true);
  const flags: Array<string | undefined> = [undefined, '', '0', 'true', 'TRUE'];
  for (const flag of flags) {
    const env = flag === undefined ? urls : { JURY_PREVIEW_DB: flag, ...urls };
    assertBlockedPreview(planPreviewDbAccess(env));
  }
});

test('preview test selection accepts one exact name and rejects a broad filter', () => {
  const source = `
    test('onboarding projection stays in the tenant', () => {});
    test('owner onboarding connects only after scope approval', () => {});
  `;
  const selected = selectExactTest(source, 'owner onboarding connects only after scope approval');
  assert.equal(selected.ok, true);
  if (selected.ok) assert.equal(selected.pattern.includes('owner onboarding connects only after scope approval'), true);
  assert.equal(selectExactTest(source, 'github |onboarding').ok, false);
  assert.equal(selectExactTest(source, 'onboarding').ok, false);
});

test('prisma refuses a production direct hostname inside the test runner without connecting', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    process.env.NODE_TEST_CONTEXT = 'child-v8';
    process.env.JURY_PREVIEW_DB = '1';
    process.env.DATABASE_URL = ${JSON.stringify(productionDirect)};
    process.env.DIRECT_URL = process.env.DATABASE_URL;
    import('./src/lib/prisma.ts').then(() => {
      console.log('CONNECTED');
      process.exit(1);
    }).catch((error) => {
      const message = String(error?.message ?? '');
      if (message.includes('secret') || message.includes('postgres://')) process.exit(3);
      console.log(message);
      process.exit(message === 'BLOCKED_PRODUCTION_DB' ? 0 : 2);
    });
  `], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(child.stdout.includes('secret'), false);
  assert.equal(child.stdout.includes('postgres://'), false);
});
