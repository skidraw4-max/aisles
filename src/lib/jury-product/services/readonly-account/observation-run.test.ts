import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JuryActor } from '../../access';
import { observationScopeHash } from './consent';
import { READONLY_ACCOUNT_CONSENT_VERSION } from './consent-text';
import { createTestKeyProvider, encryptAccountCredential } from './credential-crypto';
import type { ObservationDriver, ObservedRequest, RequestVerdict } from './executor';
import { actionsForPaths, normalizeLoginPlan, READONLY_ACCOUNT_OBSERVATION_AUDIT, runStoredCredentialObservation, type ObservationRunStore } from './observation-run';

const owner = { ok: true, userId: 'u1', tenantId: 't1', role: 'OWNER' } as JuryActor;
const viewer = { ok: true, userId: 'u2', tenantId: 't1', role: 'VIEWER' } as JuryActor;
const scope = { allowedOrigins: ['https://app.example.com'], paths: ['/dashboard'] };
const login = { loginUrl: 'https://app.example.com/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s', successPathPrefix: '/dashboard' };

function driver() {
  let guard: (r: ObservedRequest) => RequestVerdict = () => 'block';
  let url = 'about:blank';
  const log = { fills: 0, gotos: [] as string[], closed: 0 };
  const d: ObservationDriver = {
    async setRequestGuard(g) { guard = g; },
    async goto(target) {
      if (guard({ method: 'GET', url: target, isFormSubmit: false, isNavigation: true }) === 'allow') { url = target; log.gotos.push(target); }
    },
    async fill() { log.fills += 1; },
    async click() {
      if (guard({ method: 'POST', url: login.loginUrl, isFormSubmit: true, isNavigation: true }) === 'allow') url = 'https://app.example.com/dashboard';
    },
    async currentUrl() { return url; },
    async detectChallenge() { return 'NONE'; },
    async snapshotText() { return 'dashboard text'; },
    async close() { log.closed += 1; },
  };
  return { d, log };
}

async function setup() {
  const provider = createTestKeyProvider();
  const enc = await encryptAccountCredential({ username: 'admin', password: 'pw' }, { tenantId: 't1', connectionId: 'c1' }, provider);
  const audits: string[] = [];
  const store: ObservationRunStore = {
    async findConnection(tenantId, id) { return tenantId === 't1' && id === 'c1' ? { id, tenantId, serviceKey: 'svc', accessMethod: 'READ_ONLY_ACCOUNT' } : null; },
    async findLatestConsent() { return { connectionId: 'c1', tenantId: 't1', version: READONLY_ACCOUNT_CONSENT_VERSION, scopeHash: observationScopeHash(scope) }; },
    async findActiveCredential() { return { ...enc, expiresAt: new Date(Date.now() + 60_000), destroyedAt: null }; },
    async audit(e) { audits.push(`${e.action}:${JSON.stringify(e)}`); },
  };
  return { provider, store, audits };
}

test('runs one observation with the stored credential through the injected driver', async () => {
  const { provider, store, audits } = await setup();
  const { d, log } = driver();
  const r = await runStoredCredentialObservation({ actor: owner, connectionId: 'c1', scope, login, store, keys: { ok: true, provider }, createDriver: () => d });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.summary.readOnly, true);
  assert.equal(log.fills, 2);
  assert.equal(audits.length, 1);
  assert.match(audits[0]!, new RegExp(`^${READONLY_ACCOUNT_OBSERVATION_AUDIT}:`));
  assert.doesNotMatch(audits[0]!, /admin|pw|dashboard text/);
});

test('refuses before launching a browser when preconditions fail', async () => {
  const { provider, store } = await setup();
  let launched = 0;
  const createDriver = () => { launched += 1; return driver().d; };
  const base = { connectionId: 'c1', scope, login, store, keys: { ok: true as const, provider }, createDriver };
  assert.deepEqual(await runStoredCredentialObservation({ ...base, actor: viewer }), { ok: false, reason: 'FORBIDDEN' });
  assert.deepEqual(await runStoredCredentialObservation({ ...base, actor: owner, keys: { ok: false, reason: 'NOT_CONFIGURED' } }), { ok: false, reason: 'KEY_NOT_CONFIGURED' });
  assert.deepEqual(await runStoredCredentialObservation({ ...base, actor: owner, scope: { ...scope, paths: ['/other'] } }), { ok: false, reason: 'CONSENT_STALE' });
  assert.deepEqual(await runStoredCredentialObservation({ ...base, actor: owner, login: { ...login, loginUrl: 'http://app.example.com/login' } }), { ok: false, reason: 'LOGIN_PLAN_INVALID' });
  assert.deepEqual(await runStoredCredentialObservation({ ...base, actor: owner, store: { ...store, findActiveCredential: async () => null } }), { ok: false, reason: 'CREDENTIAL_UNAVAILABLE' });
  assert.equal(launched, 0);
});

test('login plan and action helpers', () => {
  assert.equal(normalizeLoginPlan({ ...login, successPathPrefix: '' })?.successPathPrefix, '/');
  assert.equal(normalizeLoginPlan({ ...login, usernameSelector: '' }), null);
  assert.deepEqual(actionsForPaths(['/a']), [{ type: 'goto', path: '/a' }, { type: 'snapshot', label: '/a' }]);
});

test('I-047: persists a PII-free run summary via recordRun', async () => {
  const { provider, store } = await setup();
  const runs: unknown[] = [];
  store.recordRun = async (r) => { runs.push(r); };
  const { d } = driver();
  const r = await runStoredCredentialObservation({ actor: owner, connectionId: 'c1', scope, login, store, keys: { ok: true, provider }, createDriver: () => d });
  assert.equal(r.ok, true);
  assert.equal(runs.length, 1);
  assert.doesNotMatch(JSON.stringify(runs[0]), /admin|"pw"|dashboard text/);
});

test('I-047: a recordRun failure does not fail the observation', async () => {
  const { provider, store } = await setup();
  store.recordRun = async () => { throw new Error('db down'); };
  const { d } = driver();
  const r = await runStoredCredentialObservation({ actor: owner, connectionId: 'c1', scope, login, store, keys: { ok: true, provider }, createDriver: () => d });
  assert.equal(r.ok, true);
});
