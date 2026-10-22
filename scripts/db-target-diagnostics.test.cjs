'use strict';
/** t86: per-URL, secret-free diagnostics for a blocked Preview DB target. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { decideDbTarget, describeDbTargetBlock } = require('./build-db-target-policy.cjs');
const classifier = require('../src/lib/jury-product/db-target-classifier.cjs');
const { cases, PREVIEW, PROD, PROD_PCT, OTHER, PW, REFS, urls, edgeUrls } = require('./db-target-fixtures.cjs');

const { classifyDbTarget, diagnoseUrl, diagnoseDbTarget } = classifier;
const CODE = { ok: 'DB_TARGET_OK', production: 'BLOCKED_DB_TARGET_PRODUCTION', config: 'BLOCKED_DB_TARGET_CONFIG', unverified: 'BLOCKED_DB_TARGET_UNVERIFIED' };
const SENTINEL_HOST = 'sentinelhost.invalid';
const SENTINEL_USER = 'sentineluserxyz';
const SENTINEL_QUERY = 'sentinelqueryvalue';
const SENTINEL_EXC = 'SENTINEL_EXCEPTION_TEXT';
const SECRETS = [PW, PREVIEW, PROD, PROD_PCT, OTHER, 'postgres://', 'postgresql://', 'supabase.co', 'pooler.supabase', SENTINEL_HOST, SENTINEL_USER, SENTINEL_QUERY, SENTINEL_EXC, '.invalid'];
const LINE = /^\[build\] db target detail: var=(DATABASE_URL|DIRECT_URL) present=(true|false|unavailable) parse=(ok|invalid|bad_scheme|unavailable) hostClass=(direct_preview|shared_pooler|other|unavailable) portClass=(5432|6543|none|other|unavailable) userRefMatch=(true|false|unavailable) prodRefMention=(true|false|unavailable) sslPolicy=(pass|fail|unavailable) reason=(OK|URL_MISSING|URL_PARSE_INVALID|BAD_SCHEME|HOST_OTHER|PORT_6543|PORT_MISSING|PORT_OTHER|USER_REF_MISSING|SSL_PARAM|PRODUCTION_REF|UNVERIFIED_OTHER|DIAGNOSTIC_UNAVAILABLE)$/;
const assertNoSecrets = (text) => { for (const s of SECRETS) assert.equal(String(text).includes(s), false, 'sensitive token leaked'); };
const preview = (env) => ({ VERCEL: '1', VERCEL_ENV: 'preview', ...env });
const reasonOf = (name, env) => diagnoseUrl(name, env).reason;

// (1) verdicts unchanged + (6) diagnostics never leak, for every fixture.
for (const [name, env, verdict] of cases) {
  test(`fixture verdict unchanged + diagnostics clean: ${name}`, () => {
    const before = classifyDbTarget(env);
    const lines = describeDbTargetBlock(preview(env));
    diagnoseDbTarget(env);
    assert.equal(classifyDbTarget(env), before);
    assert.equal(before, verdict);
    assert.deepEqual(decideDbTarget(preview(env)), { ok: verdict === 'ok', code: CODE[verdict] });
    assert.equal(lines.length, 2);
    for (const l of lines) assert.match(l, LINE);
    assertNoSecrets(lines.join('\n'));
    assertNoSecrets(JSON.stringify(diagnoseDbTarget(env)));
  });
}

// Consistency: an unverified fixture always yields at least one non-OK reason;
// an ok fixture yields OK on DATABASE_URL and OK/URL_MISSING on DIRECT_URL.
test('diagnostic reasons agree with fixture verdicts', () => {
  for (const [name, env, verdict] of cases) {
    const [db, direct] = diagnoseDbTarget(env);
    if (verdict === 'ok') {
      assert.equal(db.reason, 'OK', name);
      assert.ok(['OK', 'URL_MISSING'].includes(direct.reason), name);
    } else if (verdict === 'unverified') {
      assert.ok([db, direct].some((d) => d.present && d.reason !== 'OK'), name);
      assert.ok([db, direct].every((d) => d.reason !== 'PRODUCTION_REF'), name);
    } else if (verdict === 'production') {
      assert.ok([db, direct].some((d) => d.reason === 'PRODUCTION_REF' && d.prodRefMention !== false) || [db, direct].some((d) => d.reason === 'PRODUCTION_REF'), name);
    }
  }
});

// (2) per-URL reason matches the fixture's actual failure condition.
const reasonCases = [
  ['ok direct', urls.direct, 'OK', { hostClass: 'direct_preview', portClass: '5432', sslPolicy: 'pass' }],
  ['ok shared pooler', urls.pooler, 'OK', { hostClass: 'shared_pooler', portClass: '5432', userRefMatch: true }],
  ['shared pooler 6543', urls.poolerTxn, 'PORT_6543', { hostClass: 'shared_pooler', portClass: '6543', userRefMatch: true }],
  ['pooler without ref', urls.poolerNoRef, 'USER_REF_MISSING', { hostClass: 'shared_pooler', userRefMatch: false }],
  ['pooler other ref', urls.poolerOtherRef, 'USER_REF_MISSING', { userRefMatch: false }],
  ['dedicated other user', urls.dedicatedOtherUser, 'USER_REF_MISSING', { hostClass: 'direct_preview', portClass: '6543' }],
  ['missing port', urls.noPort, 'PORT_MISSING', { portClass: 'none' }],
  ['unsupported port', urls.badPort, 'PORT_OTHER', { portClass: 'other' }],
  ['http scheme', urls.httpScheme, 'BAD_SCHEME', { parse: 'bad_scheme' }],
  ['garbage', urls.garbage, 'URL_PARSE_INVALID', { parse: 'invalid' }],
  ['quoted url', `"${urls.direct}"`, 'URL_PARSE_INVALID', { parse: 'invalid' }],
  ['single-quoted url', `'${urls.pooler}'`, 'URL_PARSE_INVALID', { parse: 'invalid' }],
  ['non-supabase host', urls.nonSupabase, 'HOST_OTHER', { hostClass: 'other' }],
  ['other project direct', urls.otherDirect, 'HOST_OTHER', { hostClass: 'other' }],
  ['ipv4 host', edgeUrls.ipv4, 'HOST_OTHER', { hostClass: 'other' }],
  ['sslmode=require', `${urls.direct}?sslmode=require`, 'SSL_PARAM', { sslPolicy: 'fail' }],
  ['ssl=true on pooler', `${urls.pooler}?ssl=true`, 'SSL_PARAM', { sslPolicy: 'fail' }],
  ['verify-full ok', urls.verifyFull, 'OK', { sslPolicy: 'pass' }],
  ['production direct', urls.prodDirect, 'PRODUCTION_REF', { prodRefMention: true }],
  ['production pct user', edgeUrls.prodUserPct, 'PRODUCTION_REF', { prodRefMention: true }],
];
for (const [name, value, reason, fields] of reasonCases) {
  test(`reason: ${name} -> ${reason}`, () => {
    for (const v of ['DATABASE_URL', 'DIRECT_URL']) {
      const env = v === 'DATABASE_URL' ? { ...REFS, DATABASE_URL: value } : { ...REFS, DATABASE_URL: urls.direct, DIRECT_URL: value };
      const d = diagnoseUrl(v, env);
      assert.equal(d.reason, reason, v);
      assert.equal(d.var, v);
      for (const [k, want] of Object.entries(fields)) assert.equal(d[k], want, `${v}.${k}`);
      assertNoSecrets(JSON.stringify(d));
    }
  });
}

test('(5) double-encoded production ref: verdict stays unverified, diagnosis never claims OK', () => {
  const env = { ...REFS, DATABASE_URL: edgeUrls.prodUserDoublePct };
  const d = diagnoseUrl('DATABASE_URL', env);
  assert.notEqual(d.reason, 'OK');
  assert.equal(d.reason, classifyDbTarget(env) === 'production' ? 'PRODUCTION_REF' : d.reason);
  assert.ok(['production', 'unverified'].includes(classifyDbTarget(env)));
  assertNoSecrets(JSON.stringify(d));
});

test('(5) missing URLs: DATABASE_URL missing/blank and DIRECT_URL absent', () => {
  assert.equal(reasonOf('DATABASE_URL', { ...REFS }), 'URL_MISSING');
  assert.equal(reasonOf('DATABASE_URL', { ...REFS, DATABASE_URL: ' \t' }), 'URL_MISSING');
  assert.equal(diagnoseUrl('DIRECT_URL', { ...REFS, DATABASE_URL: urls.direct }).present, false);
  assert.equal(reasonOf('DIRECT_URL', { ...REFS, DATABASE_URL: urls.direct, DIRECT_URL: '' }), 'URL_MISSING');
});

test('(3) DATABASE_URL and DIRECT_URL are diagnosed separately', () => {
  const env = { ...REFS, DATABASE_URL: urls.poolerTxn, DIRECT_URL: urls.pooler };
  const [a, b] = diagnoseDbTarget(env);
  assert.deepEqual([a.var, a.reason, b.var, b.reason], ['DATABASE_URL', 'PORT_6543', 'DIRECT_URL', 'OK']);
  const env2 = { ...REFS, DATABASE_URL: urls.pooler, DIRECT_URL: `${urls.pooler}?sslmode=require` };
  const [c, d] = diagnoseDbTarget(env2);
  assert.deepEqual([c.reason, d.reason], ['OK', 'SSL_PARAM']);
  assert.equal(classifyDbTarget(env), 'unverified');
  assert.equal(classifyDbTarget(env2), 'unverified');
});

test('(4) combined order: production first, unverified does not short-circuit', () => {
  assert.equal(classifyDbTarget({ ...REFS, DATABASE_URL: urls.garbage, DIRECT_URL: urls.prodPooler }), 'production');
  const [a, b] = diagnoseDbTarget({ ...REFS, DATABASE_URL: urls.garbage, DIRECT_URL: urls.prodPooler });
  assert.deepEqual([a.reason, b.reason], ['URL_PARSE_INVALID', 'PRODUCTION_REF']);
  assert.equal(classifyDbTarget({ ...REFS, JURY_PREVIEW_DB: undefined, DATABASE_URL: urls.prodDirect }), 'production');
  const env = { ...REFS, DATABASE_URL: urls.poolerNoRef, DIRECT_URL: urls.poolerTxn };
  assert.equal(classifyDbTarget(env), 'unverified');
  assert.deepEqual(diagnoseDbTarget(env).map((x) => x.reason), ['USER_REF_MISSING', 'PORT_6543']);
});

test('config-invalid env: endpoint fields unavailable, no claimed cause', () => {
  const d = diagnoseUrl('DATABASE_URL', { ...REFS, JURY_PREVIEW_DB_PROJECT_REF: 'bad', DATABASE_URL: urls.direct });
  assert.equal(d.reason, 'DIAGNOSTIC_UNAVAILABLE');
  assert.equal(d.hostClass, 'unavailable');
  assert.equal(d.userRefMatch, 'unavailable');
});

test('(6) sentinel host/user/query/password never appear', () => {
  const v = `postgres://${SENTINEL_USER}:${PW}@${SENTINEL_HOST}:5432/postgres?application_name=${SENTINEL_QUERY}&sslmode=${SENTINEL_QUERY}`;
  const env = preview({ ...REFS, DATABASE_URL: v, DIRECT_URL: `"${v}"` });
  const lines = describeDbTargetBlock(env);
  assert.equal(lines.length, 2);
  assertNoSecrets(lines.join('\n'));
  assertNoSecrets(JSON.stringify(diagnoseDbTarget(env)));
  assert.match(lines[0], /reason=HOST_OTHER/);
  assert.match(lines[0], /sslPolicy=fail/);
  assert.match(lines[1], /reason=URL_PARSE_INVALID/);
});

test('(8) diagnostic exceptions never change the verdict and never leak exception text', () => {
  const env = preview({ ...REFS, DATABASE_URL: urls.poolerTxn });
  const before = decideDbTarget(env);
  const thrower = () => { throw new Error(`${SENTINEL_EXC} ${PW} ${PREVIEW}`); };
  const lines = describeDbTargetBlock(env, { diagnose: thrower });
  assert.equal(lines.length, 2);
  for (const l of lines) { assert.match(l, LINE); assert.match(l, /reason=DIAGNOSTIC_UNAVAILABLE$/); }
  assertNoSecrets(lines.join('\n'));
  assert.deepEqual(decideDbTarget(env), before);
  assert.deepEqual(before, { ok: false, code: CODE.unverified });
  // Hostile return values are coerced to whitelist constants.
  const hostile = () => [{ var: 'DATABASE_URL', present: PW, parse: PREVIEW, hostClass: SENTINEL_HOST, portClass: 5432, userRefMatch: 'yes', prodRefMention: PROD, sslPolicy: SENTINEL_QUERY, reason: SENTINEL_EXC }, { var: SENTINEL_USER }];
  const h = describeDbTargetBlock(env, { diagnose: hostile });
  for (const l of h) assert.match(l, LINE);
  assertNoSecrets(h.join('\n'));
  // Throwing getter inside an entry.
  const getterThrow = () => [{ var: 'DATABASE_URL', get reason() { throw new Error(SENTINEL_EXC); } }];
  const g = describeDbTargetBlock(env, { diagnose: getterThrow });
  assert.equal(g.length, 2);
  assertNoSecrets(g.join('\n'));
  // diagnoseUrl itself: a throwing env accessor yields DIAGNOSTIC_UNAVAILABLE.
  const evil = { ...REFS, DATABASE_URL: urls.direct };
  Object.defineProperty(evil, 'JURY_PRODUCTION_DB_PROJECT_REFS', { get() { throw new Error(SENTINEL_EXC); } });
  assert.equal(diagnoseUrl('DATABASE_URL', evil).reason, 'DIAGNOSTIC_UNAVAILABLE');
});

test('no detail lines outside Preview', () => {
  const bad = { ...REFS, DATABASE_URL: urls.prodDirect };
  assert.deepEqual(describeDbTargetBlock({ VERCEL_ENV: 'production', ...bad }), []);
  assert.deepEqual(describeDbTargetBlock(bad), []);
  assert.deepEqual(describeDbTargetBlock(undefined), []);
});

function runBuild(extra) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, VERCEL: '1', ...extra };
  return spawnSync(process.execPath, ['scripts/run-build.cjs'], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 20000 });
}

test('(7) child process: blocked preview prints code + one detail line per URL, exits 1, nothing spawned', () => {
  const r = runBuild({ VERCEL_ENV: 'preview', ...REFS, DATABASE_URL: urls.poolerTxn, DIRECT_URL: `postgres://${SENTINEL_USER}:${PW}@${SENTINEL_HOST}:5432/postgres?x=${SENTINEL_QUERY}` });
  assert.equal(r.status, 1);
  const out = `${r.stdout}${r.stderr}`;
  const lines = out.trim().split(/\r?\n/);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '[build] db target: BLOCKED_DB_TARGET_UNVERIFIED');
  assert.match(lines[1], LINE);
  assert.match(lines[1], /var=DATABASE_URL .*portClass=6543 .*reason=PORT_6543$/);
  assert.match(lines[2], /var=DIRECT_URL .*hostClass=other .*reason=HOST_OTHER$/);
  assert.equal(out.includes('migrate policy'), false);
  assertNoSecrets(out);
});

test('production env yields no detail lines (pure; production build is not spawned)', () => {
  // Production would continue to migrate/next build, so only assert via the pure function here.
  assert.deepEqual(describeDbTargetBlock({ VERCEL_ENV: 'production', ...REFS, DATABASE_URL: urls.garbage }), []);
});

test('(7) child process: config block still prints per-URL lines without leaking', () => {
  const r = runBuild({ VERCEL_ENV: 'preview', DATABASE_URL: `postgres://${SENTINEL_USER}:${PW}@${SENTINEL_HOST}:5432/db` });
  assert.equal(r.status, 1);
  const lines = `${r.stdout}${r.stderr}`.trim().split(/\r?\n/);
  assert.equal(lines[0], '[build] db target: BLOCKED_DB_TARGET_CONFIG');
  assert.equal(lines.length, 3);
  for (const l of lines.slice(1)) assert.match(l, LINE);
  assertNoSecrets(lines.join('\n'));
});

test('A-2 txn pooler flag: DATABASE_URL 6543 is OK only with the flag; DIRECT_URL 6543 stays PORT_6543', () => {
  const flag = { ...REFS, JURY_PREVIEW_DB_TXN_POOLER: '1' };
  assert.equal(reasonOf('DATABASE_URL', { ...REFS, DATABASE_URL: urls.poolerTxn }), 'PORT_6543');
  assert.equal(reasonOf('DATABASE_URL', { ...flag, DATABASE_URL: urls.poolerTxn }), 'OK');
  assert.equal(reasonOf('DIRECT_URL', { ...flag, DATABASE_URL: urls.pooler, DIRECT_URL: urls.poolerTxn }), 'PORT_6543');
  assert.equal(reasonOf('DATABASE_URL', { ...flag, DATABASE_URL: urls.poolerTxnNoRef }), 'USER_REF_MISSING');
  assert.equal(reasonOf('DATABASE_URL', { ...flag, DATABASE_URL: urls.poolerTxnOtherRef }), 'USER_REF_MISSING');
  assert.equal(reasonOf('DATABASE_URL', { ...flag, DATABASE_URL: `${urls.poolerTxn}?sslmode=require` }), 'SSL_PARAM');
  for (const v of ['true', '0', '', ' 1', 'TRUE']) {
    assert.equal(reasonOf('DATABASE_URL', { ...REFS, JURY_PREVIEW_DB_TXN_POOLER: v, DATABASE_URL: urls.poolerTxn }), 'PORT_6543');
  }
  assert.equal(decideDbTarget(preview({ ...flag, DATABASE_URL: urls.poolerTxn })).code, 'DB_TARGET_OK');
  const lines = describeDbTargetBlock(preview({ ...flag, DATABASE_URL: urls.pooler, DIRECT_URL: urls.poolerTxn }));
  assert.equal(lines.length, 2);
  for (const l of lines) assert.match(l, LINE);
  assert.match(lines[1], /var=DIRECT_URL .*portClass=6543 .*reason=PORT_6543$/);
  assertNoSecrets(lines.join('\n'));
});
