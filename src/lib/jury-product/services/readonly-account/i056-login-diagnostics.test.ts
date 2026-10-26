import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeReadonlyObservation, type ObservationDriver } from './executor';
import { summarizeObservation, logBlockedRequests } from './observation-evidence';
import { toLatestObservationRun } from './latest-observation';
import { readonlyAccountStopDetail, readonlyAccountStopText, usesDefaultLoginSelectors } from './result-text';

const scope = { allowedOrigins: ['https://app.example.com'], paths: ['/'] };
const login = { loginUrl: 'https://app.example.com/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#go', successPathPrefix: '/' };
const credential = { username: 'user-x', password: 'pw-secret-x' };

function driver(over: Partial<ObservationDriver> & { fields?: string[] } = {}): ObservationDriver & { fills: number } {
  let url = 'https://app.example.com/login';
  const d = {
    fills: 0,
    async setRequestGuard() {},
    async goto(u: string) {
      url = u;
    },
    async fill() {
      d.fills += 1;
      return true;
    },
    async click() {
      url = 'https://app.example.com/home';
    },
    async currentUrl() {
      return url;
    },
    async detectChallenge() {
      return 'NONE' as const;
    },
    async hasField(sel: string) {
      return (over.fields ?? ['#u', '#p', '#go']).includes(sel);
    },
    async snapshotText() {
      return 'hello';
    },
    async close() {},
    ...over,
  };
  return d as ObservationDriver & { fills: number };
}

test('I-056: missing username field → LOGIN_FIELD_NOT_FOUND (USERNAME), nothing typed, no login attempt', async () => {
  const d = driver({ fields: ['#p', '#go'] });
  const r = await executeReadonlyObservation({ driver: d, credential, scope, login, actions: [] });
  assert.equal(r.stop, 'LOGIN_FIELD_NOT_FOUND');
  assert.equal(r.missingField, 'USERNAME');
  assert.equal(r.loginAttempts, 0);
  assert.equal(d.fills, 0);
});

test('I-056: missing submit button → SUBMIT', async () => {
  const r = await executeReadonlyObservation({ driver: driver({ fields: ['#u', '#p'] }), credential, scope, login, actions: [] });
  assert.equal(r.missingField, 'SUBMIT');
});

test('I-056: thrown driver error records the failing step', async () => {
  const r = await executeReadonlyObservation({
    driver: driver({
      async click() {
        throw new Error('boom');
      },
    }),
    credential,
    scope,
    login,
    actions: [],
  });
  assert.equal(r.stop, 'DRIVER_ERROR');
  assert.equal(r.failedStep, 'SUBMIT');
  assert.equal(readonlyAccountStopDetail(r), '중단된 단계: 로그인 버튼 누르기');
});

test('I-056: summary/log carry the diagnosis but never credential values; stored diag round-trips', async () => {
  const r = await executeReadonlyObservation({ driver: driver({ fields: ['#u', '#go'] }), credential, scope, login, actions: [] });
  const s = summarizeObservation(r);
  assert.equal(s.missingField, 'PASSWORD');
  let line = '';
  logBlockedRequests(r, 'c1', (l) => (line = l));
  assert.ok(line.includes('"missingField":"PASSWORD"'));
  assert.ok(!line.includes(credential.password) && !line.includes(credential.username));
  const run = toLatestObservationRun({
    id: 'r', ok: false, stop: 'LOGIN_FIELD_NOT_FOUND', challenge: null, loginAttempts: 0, pagesObserved: 0, pagesVisible: 0, pages: [],
    blockedRequestCount: 0, blockedByReason: { ORIGIN: 0, METHOD: 0, FORM_SUBMIT: 0, LOGIN_ALREADY_USED: 0, diag: { failedStep: 'LOGIN_PAGE', missingField: 'PASSWORD' } },
    finalOrigin: null, finalPath: null, observedAt: new Date(0),
  });
  assert.equal(run.missingField, 'PASSWORD');
  assert.equal(readonlyAccountStopDetail(run), '찾지 못한 항목: 비밀번호 입력란');
  assert.match(readonlyAccountStopText('LOGIN_FIELD_NOT_FOUND'), /선택자/);
});

test('I-056: stored diag with unexpected values is dropped', () => {
  const run = toLatestObservationRun({
    id: 'r', ok: false, stop: 'DRIVER_ERROR', challenge: null, loginAttempts: 0, pagesObserved: 0, pagesVisible: 0, pages: [],
    blockedRequestCount: 0, blockedByReason: { diag: { failedStep: '<script>', missingField: 3 } }, finalOrigin: null, finalPath: null, observedAt: new Date(0),
  });
  assert.equal(run.failedStep, undefined);
  assert.equal(run.missingField, undefined);
});

test('I-056: default selector detection', () => {
  assert.equal(usesDefaultLoginSelectors({ usernameSelector: '#email', passwordSelector: '#password', submitSelector: 'button[type=submit]' }), true);
  assert.equal(usesDefaultLoginSelectors({ usernameSelector: '#login_id', passwordSelector: '#login_pw', submitSelector: 'button' }), false);
  assert.equal(usesDefaultLoginSelectors(null), false);
});
