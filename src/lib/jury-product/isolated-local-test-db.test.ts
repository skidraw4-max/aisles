import assert from 'node:assert/strict';
import test from 'node:test';
import { isIsolatedLocalTestDb } from './preview-db-guard';

const LOCAL = 'postgresql://u:p@127.0.0.1:5432/jury_test';

test('RM-00b isolated local test DB requires explicit opt-in and loopback only', () => {
  assert.equal(isIsolatedLocalTestDb({ DATABASE_URL: LOCAL } as NodeJS.ProcessEnv), false);
  assert.equal(isIsolatedLocalTestDb({ JURY_LOCAL_TEST_DB: '1', DATABASE_URL: LOCAL } as NodeJS.ProcessEnv), true);
  assert.equal(
    isIsolatedLocalTestDb({ JURY_LOCAL_TEST_DB: '1', DATABASE_URL: LOCAL, DIRECT_URL: 'postgresql://u:p@localhost:5432/x' } as NodeJS.ProcessEnv),
    true,
  );
  assert.equal(
    isIsolatedLocalTestDb({ JURY_LOCAL_TEST_DB: '1', DATABASE_URL: LOCAL, DIRECT_URL: 'postgresql://u:p@db.abcdefghijklmnopqrst.supabase.co:5432/postgres' } as NodeJS.ProcessEnv),
    false,
  );
  assert.equal(isIsolatedLocalTestDb({ JURY_LOCAL_TEST_DB: '1', DATABASE_URL: 'postgresql://u:p@10.0.0.5:5432/x' } as NodeJS.ProcessEnv), false);
  assert.equal(isIsolatedLocalTestDb({ JURY_LOCAL_TEST_DB: '1', JURY_PREVIEW_DB: '1', DATABASE_URL: LOCAL } as NodeJS.ProcessEnv), false);
  assert.equal(isIsolatedLocalTestDb({ JURY_LOCAL_TEST_DB: '1', VERCEL_ENV: 'production', DATABASE_URL: LOCAL } as NodeJS.ProcessEnv), false);
  assert.equal(isIsolatedLocalTestDb({ JURY_LOCAL_TEST_DB: '1' } as NodeJS.ProcessEnv), false);
});
