import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { classifyConnectionUrl, classifyDbTarget, readRefConfig } from './db-target-classifier.cjs';
import {
  guardTestDatabase,
  isKnownPreviewEndpoint,
  isPreviewRuntime,
  planPreviewDbAccess,
  planRuntimeDbTarget,
  readPreviewDbRefConfig,
  requireRuntimeDbTarget,
} from './preview-db-guard';

const require = createRequire(import.meta.url);
// CommonJS consumers of the SAME classifier module (build side).
const { decideDbTarget } = require('../../../scripts/build-db-target-policy.cjs');
const cjsClassifier = require('./db-target-classifier.cjs');
const { cases, PREVIEW, PROD, OTHER, PW, REFS, urls } = require('../../../scripts/db-target-fixtures.cjs') as {
  cases: [string, Record<string, string | undefined>, 'ok' | 'production' | 'config' | 'unverified'][];
  PREVIEW: string; PROD: string; OTHER: string; PW: string;
  REFS: Record<string, string>; urls: Record<string, string>;
};

const BUILD_TO_RUNTIME: Record<string, string> = {
  DB_TARGET_OK: 'ok',
  BLOCKED_DB_TARGET_PRODUCTION: 'BLOCKED_PRODUCTION_DB',
  BLOCKED_DB_TARGET_CONFIG: 'BLOCKED_PREVIEW_DB',
  BLOCKED_DB_TARGET_UNVERIFIED: 'BLOCKED_PREVIEW_DB',
};

test('TS import and CommonJS require resolve to the same classifier functions', () => {
  assert.equal(classifyDbTarget, cjsClassifier.classifyDbTarget);
  assert.equal(classifyConnectionUrl, cjsClassifier.classifyConnectionUrl);
  assert.deepEqual(readPreviewDbRefConfig(REFS), readRefConfig(REFS));
});

for (const [name, env, verdict] of cases) {
  test(`parity: ${name}`, () => {
    assert.equal(classifyDbTarget(env), verdict);
    const build = decideDbTarget({ VERCEL: '1', VERCEL_ENV: 'preview', ...env });
    const runtime = planRuntimeDbTarget({ VERCEL_ENV: 'preview', ...env });
    const runtimeStatus = runtime.ok ? 'ok' : runtime.status;
    assert.equal(runtimeStatus, BUILD_TO_RUNTIME[build.code], `build=${build.code}`);
    const text = JSON.stringify([build, runtime]);
    for (const s of [PW, PREVIEW, PROD, OTHER, 'postgres']) assert.equal(text.includes(s), false);
  });
}

test('preview runtime detection', () => {
  assert.equal(isPreviewRuntime({ VERCEL_ENV: 'preview' }), true);
  assert.equal(isPreviewRuntime({ JURY_PREVIEW_DB: '1' }), true);
  assert.equal(isPreviewRuntime({ VERCEL_ENV: 'production' }), false);
  assert.equal(isPreviewRuntime({}), false);
});

test('requireRuntimeDbTarget: VERCEL_ENV=preview without JURY_PREVIEW_DB=1 fails closed', () => {
  assert.throws(() => requireRuntimeDbTarget({ VERCEL_ENV: 'preview', ...REFS, JURY_PREVIEW_DB: undefined, DATABASE_URL: urls.direct }), /^Error: BLOCKED_PREVIEW_DB$/);
});

test('requireRuntimeDbTarget: JURY_PREVIEW_DB=1 alone still runs the ref check', () => {
  assert.throws(() => requireRuntimeDbTarget({ JURY_PREVIEW_DB: '1', DATABASE_URL: urls.direct }), /^Error: BLOCKED_PREVIEW_DB$/);
  assert.throws(() => requireRuntimeDbTarget({ ...REFS, DATABASE_URL: urls.prodPooler }), /^Error: BLOCKED_PRODUCTION_DB$/);
  assert.doesNotThrow(() => requireRuntimeDbTarget({ ...REFS, DATABASE_URL: urls.pooler }));
});

test('requireRuntimeDbTarget: non-preview is a no-op (production/local unchanged)', () => {
  assert.doesNotThrow(() => requireRuntimeDbTarget({ VERCEL_ENV: 'production', DATABASE_URL: urls.garbage }));
  assert.doesNotThrow(() => requireRuntimeDbTarget({}));
});

test('thrown errors carry only the fixed status', () => {
  for (const env of [{ ...REFS, DATABASE_URL: urls.prodDirect }, { ...REFS, DATABASE_URL: urls.garbage }, { VERCEL_ENV: 'preview' }]) {
    try {
      requireRuntimeDbTarget(env);
      assert.fail('expected throw');
    } catch (error) {
      const msg = (error as Error).message;
      assert.match(msg, /^BLOCKED_(PRODUCTION|PREVIEW)_DB$/);
      for (const s of [PW, PREVIEW, PROD, 'postgres']) assert.equal(String((error as Error).stack).includes(s), false);
    }
  }
});

test('shared classifier: any-region pooler allowed; production on any region blocked; existing test guard unchanged', () => {
  const refs = readRefConfig(REFS);
  assert.equal(classifyConnectionUrl(urls.poolerOtherRegion, refs), 'allowed');
  assert.equal(classifyConnectionUrl(urls.prodPoolerOtherRegion, refs), 'production');
  assert.equal(isKnownPreviewEndpoint(urls.pooler, refs), true);
  // planPreviewDbAccess still requires both URLs and JURY_PREVIEW_DB=1 (test-path semantics).
  assert.equal(planPreviewDbAccess({ ...REFS, DATABASE_URL: urls.direct }).ok, false);
  assert.equal(planPreviewDbAccess({ ...REFS, DATABASE_URL: urls.direct, DIRECT_URL: urls.pooler }).ok, true);
  // guardTestDatabase is still a no-op outside node:test contexts.
  assert.doesNotThrow(() => guardTestDatabase({ DATABASE_URL: urls.prodDirect } as NodeJS.ProcessEnv));
});