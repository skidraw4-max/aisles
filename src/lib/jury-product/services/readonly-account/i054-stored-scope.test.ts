import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { JuryActor } from '../../access';
import { normalizeObservationScope, observationScopeHash, storedConsentScope } from './consent';
import { READONLY_ACCOUNT_CONSENT_VERSION } from './consent-text';
import { createTestKeyProvider, encryptAccountCredential } from './credential-crypto';
import type { ObservationDriver, ObservedRequest, RequestVerdict } from './executor';
import { runStoredCredentialObservation, storedLoginPlan, usesStoredScope, type ObservationRunStore } from './observation-run';
import { persistReadonlyAccountConsent, persistReadonlyAccountCredential, persistReadonlyAccountLoginSettings, type ReadonlyAccountStore } from './store';

const owner = { ok: true, userId: 'u1', tenantId: 't1', role: 'OWNER' } as JuryActor;
const viewer = { ok: true, userId: 'u2', tenantId: 't1', role: 'VIEWER' } as JuryActor;
const rawScope = { allowedOrigins: ['https://app.example.com'], authOrigins: ['https://auth.example.com'], paths: ['/dashboard'] };
const scope = (normalizeObservationScope(rawScope) as { ok: true; scope: ReturnType<typeof storedConsentScope> & object }).scope;
const login = { loginUrl: 'https://app.example.com/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s', successPathPrefix: '/dashboard' };
const blankScope = { allowedOrigins: [], authOrigins: [], paths: [] };
const blankLogin = { loginUrl: '', usernameSelector: '', passwordSelector: '', submitSelector: '', successPathPrefix: '' };
// JSONB does not keep key order: simulate by reversing keys.
const reordered = { paths: [...scope.paths], authOrigins: [...(scope.authOrigins ?? [])], allowedOrigins: [...scope.allowedOrigins] };
const consentRow = (extra: Record<string, unknown> = {}) => ({
  id: 'k1',
  connectionId: 'c1',
  tenantId: 't1',
  version: READONLY_ACCOUNT_CONSENT_VERSION,
  scopeHash: observationScopeHash(scope),
  scope: reordered,
  loginSettings: login,
  ...extra,
});

test('I-054 migration is additive, nullable and secret-free', () => {
  const sql = readFileSync('prisma/migrations/20261026210000_jury_readonly_consent_stored_scope/migration.sql', 'utf8');
  assert.match(sql, /ALTER TABLE "JuryConnectionConsent" ADD COLUMN "scope" JSONB,\s*ADD COLUMN "loginSettings" JSONB;/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /NOT NULL|DROP|password|secret/i);
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  assert.match(schema, /scope\s+Json\?/);
  assert.match(schema, /loginSettings\s+Json\?/);
});

test('storedConsentScope accepts only a hash-matching scope under the current version', () => {
  assert.deepEqual(storedConsentScope(consentRow()), scope);
  assert.equal(storedConsentScope(consentRow({ scope: null })), null);
  assert.equal(storedConsentScope(consentRow({ scope: { ...reordered, paths: ['/other'] } })), null);
  assert.equal(storedConsentScope(consentRow({ version: 'old' })), null);
  assert.equal(storedConsentScope(consentRow({ scope: 'x' })), null);
  assert.equal(storedConsentScope(null), null);
});

test('storedLoginPlan re-validates the saved login plan', () => {
  assert.deepEqual(storedLoginPlan(login), login);
  assert.equal(storedLoginPlan({ ...login, loginUrl: 'http://app.example.com/login' }), null);
  assert.equal(storedLoginPlan(null), null);
  assert.equal(usesStoredScope(blankScope), true);
  assert.equal(usesStoredScope(rawScope), false);
});

function fakeAccountStore(consent: Record<string, unknown> | null) {
  const created: Record<string, unknown>[] = [];
  const saved: unknown[] = [];
  const store: ReadonlyAccountStore = {
    async findConnection(tenantId, id) { return tenantId === 't1' && id === 'c1' ? { id, tenantId, serviceKey: 'svc', accessMethod: 'READ_ONLY_ACCOUNT' } : null; },
    async findLatestConsent() { return consent as never; },
    async createConsent(row) { created.push(row); },
    async replaceCredential() {},
    async audit() {},
    async saveLoginSettings(_t, id, settings) { saved.push({ id, settings }); },
  };
  return { store, created, saved };
}

test('consent stores the normalized scope next to its hash (no secrets)', async () => {
  const { store, created } = fakeAccountStore(null);
  const r = await persistReadonlyAccountConsent({ actor: owner, connectionId: 'c1', scope: rawScope, accepted: true, now: '2026-10-26T12:00:00.000Z', store });
  assert.equal(r.ok, true);
  assert.deepEqual(created[0]!.scope, scope);
  assert.equal(created[0]!.scopeHash, observationScopeHash(scope));
  assert.doesNotMatch(JSON.stringify(created[0]), /password/i);
});

test('credential save uses the stored scope and saves the login plan on the consent row', async () => {
  const { store, saved } = fakeAccountStore(consentRow({ loginSettings: null }));
  const r = await persistReadonlyAccountCredential({
    actor: owner, connectionId: 'c1', scope: null, username: 'viewer', password: 'pw', login,
    now: '2026-10-26T12:00:00.000Z', keyProvider: createTestKeyProvider(), store,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(saved, [{ id: 'k1', settings: login }]);
  assert.doesNotMatch(JSON.stringify(saved), /viewer|"pw"/);
});

test('credential save without stored scope falls back to CONSENT_STALE; bad login plan is rejected', async () => {
  const legacy = fakeAccountStore(consentRow({ scope: null }));
  const stale = await persistReadonlyAccountCredential({ actor: owner, connectionId: 'c1', scope: null, username: 'v', password: 'p', now: '2026-10-26T12:00:00.000Z', keyProvider: createTestKeyProvider(), store: legacy.store });
  assert.deepEqual(stale, { ok: false, reason: 'CONSENT_STALE' });
  const typed = await persistReadonlyAccountCredential({ actor: owner, connectionId: 'c1', scope, username: 'v', password: 'p', now: '2026-10-26T12:00:00.000Z', keyProvider: createTestKeyProvider(), store: legacy.store });
  assert.equal(typed.ok, true);
  const { store } = fakeAccountStore(consentRow());
  const bad = await persistReadonlyAccountCredential({ actor: owner, connectionId: 'c1', scope: null, username: 'v', password: 'p', login: { ...login, loginUrl: 'ftp://x' }, now: '2026-10-26T12:00:00.000Z', keyProvider: createTestKeyProvider(), store });
  assert.deepEqual(bad, { ok: false, reason: 'LOGIN_PLAN_INVALID' });
});

test('login-only update requires write access and a current consent with stored scope', async () => {
  const ok = fakeAccountStore(consentRow());
  assert.deepEqual(await persistReadonlyAccountLoginSettings({ actor: owner, connectionId: 'c1', login, store: ok.store }), { ok: true });
  assert.equal(ok.saved.length, 1);
  const denied = await persistReadonlyAccountLoginSettings({ actor: viewer, connectionId: 'c1', login, store: ok.store });
  assert.equal(denied.ok, false);
  const legacy = fakeAccountStore(consentRow({ scope: null }));
  assert.deepEqual(await persistReadonlyAccountLoginSettings({ actor: owner, connectionId: 'c1', login, store: legacy.store }), { ok: false, reason: 'CONSENT_STALE' });
});

function driver() {
  let guard: (r: ObservedRequest) => RequestVerdict = () => 'block';
  let url = 'about:blank';
  const log = { gotos: [] as string[], methods: [] as string[] };
  const d: ObservationDriver = {
    async setRequestGuard(g) { guard = g; },
    async goto(target) {
      if (guard({ method: 'GET', url: target, isFormSubmit: false, isNavigation: true }) === 'allow') { url = target; log.gotos.push(target); }
    },
    async fill() {},
    async click() {
      if (guard({ method: 'POST', url: login.loginUrl, isFormSubmit: true, isNavigation: true }) === 'allow') url = 'https://app.example.com/dashboard';
      log.methods.push(guard({ method: 'DELETE', url: 'https://app.example.com/api/x', isFormSubmit: false, isNavigation: false }));
    },
    async currentUrl() { return url; },
    async detectChallenge() { return 'NONE'; },
    async snapshotText() { return 'dashboard text'; },
    async close() {},
  };
  return { d, log };
}

async function runStore(consent: Record<string, unknown> | null) {
  const provider = createTestKeyProvider();
  const enc = await encryptAccountCredential({ username: 'admin', password: 'pw' }, { tenantId: 't1', connectionId: 'c1' }, provider);
  const store: ObservationRunStore = {
    async findConnection(tenantId, id) { return tenantId === 't1' && id === 'c1' ? { id, tenantId, serviceKey: 'svc', accessMethod: 'READ_ONLY_ACCOUNT' } : null; },
    async findLatestConsent() { return consent as never; },
    async findActiveCredential() { return { ...enc, expiresAt: new Date(Date.now() + 60_000), destroyedAt: null }; },
    async audit() {},
  };
  return { provider, store };
}

test('observation runs from stored scope + login with no re-entry; GET-only guard still applies', async () => {
  const { provider, store } = await runStore(consentRow());
  const { d, log } = driver();
  const r = await runStoredCredentialObservation({ actor: owner, connectionId: 'c1', scope: blankScope, login: blankLogin, store, keys: { ok: true, provider }, createDriver: () => d, discover: false });
  assert.equal(r.ok, true);
  assert.ok(log.gotos.includes('https://app.example.com/dashboard'));
  assert.ok(log.methods.every((v) => v === 'block'));
});

test('observation without stored values: legacy consent needs re-entry, missing consent is CONSENT_REQUIRED', async () => {
  const legacy = await runStore(consentRow({ scope: null }));
  const r1 = await runStoredCredentialObservation({ actor: owner, connectionId: 'c1', scope: blankScope, login: blankLogin, store: legacy.store, keys: { ok: true, provider: legacy.provider }, createDriver: () => driver().d, discover: false });
  assert.deepEqual(r1, { ok: false, reason: 'CONSENT_STALE' });
  const typed = await runStoredCredentialObservation({ actor: owner, connectionId: 'c1', scope: rawScope, login, store: legacy.store, keys: { ok: true, provider: legacy.provider }, createDriver: () => driver().d, discover: false });
  assert.equal(typed.ok, true);
  const none = await runStore(null);
  const r2 = await runStoredCredentialObservation({ actor: owner, connectionId: 'c1', scope: blankScope, login: blankLogin, store: none.store, keys: { ok: true, provider: none.provider }, createDriver: () => driver().d, discover: false });
  assert.deepEqual(r2, { ok: false, reason: 'CONSENT_REQUIRED' });
  const noLogin = await runStore(consentRow({ loginSettings: null }));
  const r3 = await runStoredCredentialObservation({ actor: owner, connectionId: 'c1', scope: blankScope, login: blankLogin, store: noLogin.store, keys: { ok: true, provider: noLogin.provider }, createDriver: () => driver().d, discover: false });
  assert.deepEqual(r3, { ok: false, reason: 'LOGIN_PLAN_INVALID' });
  const viewerRun = await runStoredCredentialObservation({ actor: viewer, connectionId: 'c1', scope: blankScope, login: blankLogin, store: legacy.store, keys: { ok: true, provider: legacy.provider }, createDriver: () => driver().d, discover: false });
  assert.equal(viewerRun.ok, false);
});
