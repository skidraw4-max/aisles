import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ga4CredentialMode, ga4ViewerFlags, ownershipFlags } from './phase1-flags';
import { isOwnershipGateApplicable, ownershipGateDecision } from './ownership/gate';
import { enforceOwnershipGate } from './ownership/enforce';
import { extractTokenCandidates, generateOwnershipToken, hashOwnershipToken, OWNERSHIP_TOKEN_PREFIX, tokenMatchesHash } from './ownership/token';
import { checkOwnership, normalizeOwnershipHost } from './ownership/checks';
import { safeOwnershipGet, type PinnedGet } from './ownership/safe-fetch';
import { recheckDueOwnerships, type OwnershipRecord, type OwnershipStore } from './ownership/service';
import { validateGa4ViewerAccess, normalizeGa4PropertyId } from './ga4-viewer/data-api';
import type { FetchLike } from './ga4-viewer/credentials';
import { selectableAccessMethods } from './selectable-methods';
import { mapConnectionMethod } from './provider-types';

const PEPPER = 'p'.repeat(40);
const ENFORCE = new Date('2026-11-01T00:00:00Z');
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('I-072: flags default off with empty env', () => {
  assert.deepEqual(ownershipFlags({}), { ui: false, enforceFrom: null });
  assert.equal(ga4CredentialMode({}), 'NONE');
  assert.equal(ga4ViewerFlags({}).enabled, false);
  assert.equal(ownershipFlags({ JURY_OWNERSHIP_UI_ENABLED: 'true', JURY_OWNERSHIP_TOKEN_PEPPER: 'short' }).ui, false);
  assert.equal(ownershipFlags({ JURY_OWNERSHIP_ENFORCE_FROM: '2026-11-01' }).enforceFrom, null);
  const on = ownershipFlags({ JURY_OWNERSHIP_UI_ENABLED: '1', JURY_OWNERSHIP_TOKEN_PEPPER: PEPPER, JURY_OWNERSHIP_ENFORCE_FROM: '2026-11-01T00:00:00Z' });
  assert.equal(on.ui, true);
  assert.equal(on.enforceFrom?.toISOString(), ENFORCE.toISOString());
});

test('I-075: credential mode is chosen by which env vars exist', () => {
  const base = { JURY_GA4_SA_EMAIL: 'sa@example.iam.gserviceaccount.com' };
  assert.equal(ga4CredentialMode(base), 'NONE');
  assert.equal(ga4CredentialMode({ ...base, JURY_GA4_SA_KEY_JSON_BASE64: 'x' }), 'JSON_KEY');
  const wif = { ...base, JURY_GA4_WIF_PROJECT_NUMBER: '1', JURY_GA4_WIF_POOL_ID: 'p', JURY_GA4_WIF_PROVIDER_ID: 'v' };
  assert.equal(ga4CredentialMode({ ...wif, JURY_GA4_SA_KEY_JSON_BASE64: 'x' }), 'WIF');
  assert.equal(ga4ViewerFlags(wif).enabled, false);
  assert.equal(ga4ViewerFlags({ ...wif, JURY_GA4_VIEWER_ENABLED: 'true' }).enabled, true);
});

test('I-073: existing (ATOMY-style) connections, GA4_VIEWER and no enforceFrom are exempt forever', () => {
  const old = new Date('2025-01-01T00:00:00Z');
  const later = new Date('2027-06-01T00:00:00Z');
  assert.equal(isOwnershipGateApplicable({ accessMethod: 'READ_ONLY_ACCOUNT', connectionCreatedAt: old, enforceFrom: ENFORCE }), false);
  assert.deepEqual(ownershipGateDecision({ accessMethod: 'READ_ONLY_ACCOUNT', connectionCreatedAt: old, enforceFrom: ENFORCE, verifiedNow: false }).allowed, true);
  assert.equal(isOwnershipGateApplicable({ accessMethod: 'GA4_VIEWER', connectionCreatedAt: later, enforceFrom: ENFORCE }), false);
  assert.equal(isOwnershipGateApplicable({ accessMethod: 'READ_ONLY_ACCOUNT', connectionCreatedAt: later, enforceFrom: null }), false);
  assert.equal(ownershipGateDecision({ accessMethod: 'READ_ONLY_ACCOUNT', connectionCreatedAt: later, enforceFrom: ENFORCE, verifiedNow: false }).allowed, false);
  assert.equal(ownershipGateDecision({ accessMethod: 'READ_ONLY_ACCOUNT', connectionCreatedAt: later, enforceFrom: ENFORCE, verifiedNow: true }).allowed, true);
});

function fakeStore(conn: { accessMethod: string; createdAt: Date }, rows: Partial<OwnershipRecord>[] = []): OwnershipStore & { calls: string[]; updates: unknown[] } {
  const calls: string[] = [];
  const updates: unknown[] = [];
  return {
    calls,
    updates,
    async findConnection(tenantId, id) {
      calls.push('findConnection');
      return { id, tenantId, serviceKey: 'svc', ...conn };
    },
    async listForConnection() {
      calls.push('list');
      return rows as OwnershipRecord[];
    },
    async upsertIssued() {},
    async update(id, data) {
      updates.push({ id, ...data });
    },
    async listDue() {
      return rows as OwnershipRecord[];
    },
    async audit() {},
  };
}
const actor = { ok: true as const, userId: 'u', tenantId: 't', role: 'OWNER' as const, membershipId: 'm' };

test('I-073: enforce gate never touches the DB while flags are off', async () => {
  const store = fakeStore({ accessMethod: 'READ_ONLY_ACCOUNT', createdAt: new Date('2027-01-01') });
  assert.deepEqual(await enforceOwnershipGate({ actor, connectionId: 'c', env: {}, store }), { allowed: true });
  assert.deepEqual(store.calls, []);
});

test('I-073: enforce gate skips verification lookup for exempt old connections and blocks new unverified ones', async () => {
  const env = { JURY_OWNERSHIP_UI_ENABLED: 'true', JURY_OWNERSHIP_TOKEN_PEPPER: PEPPER, JURY_OWNERSHIP_ENFORCE_FROM: ENFORCE.toISOString() };
  const oldStore = fakeStore({ accessMethod: 'READ_ONLY_ACCOUNT', createdAt: new Date('2025-01-01') });
  assert.deepEqual(await enforceOwnershipGate({ actor, connectionId: 'c', env, store: oldStore }), { allowed: true });
  assert.deepEqual(oldStore.calls, ['findConnection']);
  const newStore = fakeStore({ accessMethod: 'READ_ONLY_ACCOUNT', createdAt: new Date('2027-01-01') });
  assert.deepEqual(await enforceOwnershipGate({ actor, connectionId: 'c', env, store: newStore }), { allowed: false, reason: 'OWNERSHIP_REQUIRED' });
  const okStore = fakeStore({ accessMethod: 'READ_ONLY_ACCOUNT', createdAt: new Date('2027-01-01') }, [{ status: 'VERIFIED' }]);
  assert.deepEqual(await enforceOwnershipGate({ actor, connectionId: 'c', env, store: okStore }), { allowed: true });
});

test('I-072: token hash round-trip and candidate extraction', () => {
  const token = generateOwnershipToken();
  const hash = hashOwnershipToken(token, PEPPER);
  assert.ok(!hash.includes(token));
  assert.equal(tokenMatchesHash(token, hash, PEPPER), true);
  assert.equal(tokenMatchesHash(token, hash, 'q'.repeat(40)), false);
  assert.ok(extractTokenCandidates(`${OWNERSHIP_TOKEN_PREFIX}${token}\n`).some((c) => tokenMatchesHash(c, hash, PEPPER)));
});

test('I-072: host normalization rejects non-public hosts', () => {
  assert.equal(normalizeOwnershipHost('https://Example.com/path'), 'example.com');
  assert.equal(normalizeOwnershipHost('localhost'), null);
  assert.equal(normalizeOwnershipHost('127.0.0.1'), null);
});

test('I-072: checks with fake DNS / HTTP', async () => {
  const token = generateOwnershipToken();
  const tokenHash = hashOwnershipToken(token, PEPPER);
  const dnsOk = await checkOwnership({ method: 'DNS_TXT', host: 'example.com', tokenHash, pepper: PEPPER }, { resolveTxt: async () => [[`${OWNERSHIP_TOKEN_PREFIX}${token}`]] });
  assert.deepEqual(dnsOk, { ok: true });
  const dnsMissing = await checkOwnership({ method: 'DNS_TXT', host: 'example.com', tokenHash, pepper: PEPPER }, { resolveTxt: async () => { throw Object.assign(new Error('x'), { code: 'ENODATA' }); } });
  assert.deepEqual(dnsMissing, { ok: false, code: 'NOT_FOUND' });
  const html = `<html><head><meta name="jury-site-verification" content="${OWNERSHIP_TOKEN_PREFIX}${token}"></head></html>`;
  const metaOk = await checkOwnership({ method: 'META_TAG', host: 'example.com', tokenHash, pepper: PEPPER }, { lookup: publicLookup, get: async () => ({ status: 200, location: null, body: html }) });
  assert.deepEqual(metaOk, { ok: true });
  const fileWrong = await checkOwnership({ method: 'WELL_KNOWN_FILE', host: 'example.com', tokenHash, pepper: PEPPER }, { lookup: publicLookup, get: async () => ({ status: 200, location: null, body: `${OWNERSHIP_TOKEN_PREFIX}wrong-value-000000000000000000000` }) });
  assert.equal(fileWrong.ok, false);
});

test('I-072: safe fetch blocks private addresses, http, and off-host redirects', async () => {
  const get: PinnedGet = async () => ({ status: 200, location: null, body: 'x' });
  assert.deepEqual(await safeOwnershipGet(new URL('http://example.com/'), { lookup: publicLookup, get }), { ok: false, code: 'BLOCKED_URL' });
  assert.deepEqual(await safeOwnershipGet(new URL('https://example.com/'), { lookup: async () => [{ address: '10.0.0.1', family: 4 }], get }), { ok: false, code: 'BLOCKED_ADDRESS' });
  const redirectOff: PinnedGet = async () => ({ status: 302, location: 'https://evil.example.net/', body: '' });
  assert.deepEqual(await safeOwnershipGet(new URL('https://example.com/'), { lookup: publicLookup, get: redirectOff }), { ok: false, code: 'BAD_REDIRECT' });
  let hops = 0;
  const www: PinnedGet = async ({ url }) => (hops++ === 0 ? { status: 301, location: `https://www.${url.hostname}/`, body: '' } : { status: 200, location: null, body: 'ok' });
  assert.deepEqual(await safeOwnershipGet(new URL('https://example.com/'), { lookup: publicLookup, get: www }), { ok: true, status: 200, body: 'ok' });
  const loop: PinnedGet = async () => ({ status: 302, location: '/again', body: '' });
  assert.deepEqual(await safeOwnershipGet(new URL('https://example.com/'), { lookup: publicLookup, get: loop }), { ok: false, code: 'TOO_MANY_REDIRECTS' });
});

test('I-074: recheck expires after 3 consecutive failures and fails overdue pending tokens', async () => {
  const now = new Date('2027-01-10T00:00:00Z');
  const base = { tenantId: 't', connectionId: 'c', host: 'example.com', method: 'DNS_TXT' as const, tokenHash: 'h', tokenHint: 'x', verifiedAt: null, lastCheckedAt: null, nextCheckAt: null, lastFailureCode: null, createdAt: now };
  const store = fakeStore({ accessMethod: 'READ_ONLY_ACCOUNT', createdAt: now }, [
    { ...base, id: 'v', status: 'VERIFIED', failureCount: 2, expiresAt: null },
    { ...base, id: 'p', status: 'PENDING', failureCount: 0, expiresAt: new Date('2027-01-01') },
  ]);
  const summary = await recheckDueOwnerships({ store, pepper: PEPPER, now, deps: { resolveTxt: async () => [] } });
  assert.deepEqual(summary, { checked: 1, verified: 0, expired: 1, failedPending: 1 });
  assert.equal((store.updates[0] as { status: string }).status, 'EXPIRED');
  assert.equal((store.updates[1] as { status: string }).status, 'FAILED');
  assert.deepEqual(await recheckDueOwnerships({ store, pepper: null, now }), { checked: 0, verified: 0, expired: 0, failedPending: 0 });
});

function jsonKeyEnv() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { client_email: 'sa@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  return { JURY_GA4_SA_EMAIL: key.client_email, JURY_GA4_SA_KEY_JSON_BASE64: Buffer.from(JSON.stringify(key)).toString('base64') };
}

test('I-075: GA4 validation maps API errors', async () => {
  const env = jsonKeyEnv();
  const respond = (status: number, body: unknown): FetchLike => async (url) =>
    url.includes('oauth2') ? { ok: true, status: 200, json: async () => ({ access_token: 'fake' }) } : { ok: status < 300, status, json: async () => body };
  assert.deepEqual(await validateGa4ViewerAccess('abc', { env }), { ok: false, code: 'INVALID_PROPERTY_ID' });
  assert.deepEqual(await validateGa4ViewerAccess('123456789', { env: {} }), { ok: false, code: 'NOT_CONFIGURED' });
  assert.deepEqual(await validateGa4ViewerAccess('123456789', { env, fetch: respond(200, { rows: [] }) }), { ok: true, propertyId: '123456789' });
  assert.deepEqual(await validateGa4ViewerAccess('123456789', { env, fetch: respond(403, { error: { status: 'PERMISSION_DENIED' } }) }), { ok: false, code: 'PERMISSION_DENIED' });
  assert.deepEqual(await validateGa4ViewerAccess('123456789', { env, fetch: respond(404, {}) }), { ok: false, code: 'NOT_FOUND' });
  assert.deepEqual(await validateGa4ViewerAccess('123456789', { env, fetch: respond(500, {}) }), { ok: false, code: 'API_ERROR' });
  assert.equal(normalizeGa4PropertyId('properties/123456789'), '123456789');
});

test('I-075: GA4 option is selectable only behind its flag; method maps through', () => {
  assert.deepEqual(selectableAccessMethods({ readonlyAccount: false, ga4Viewer: false }), []);
  assert.deepEqual(selectableAccessMethods({ readonlyAccount: false, ga4Viewer: true }).map((m) => m.value), ['GA4_VIEWER']);
  assert.equal(mapConnectionMethod('GA4_VIEWER'), 'GA4_VIEWER');
});

test('I-072: ownership/GA4 UI copy uses 해요체 and sections are flag-gated', () => {
  const sections = readFileSync('src/app/(jury)/jury/phase1-sections.tsx', 'utf8');
  assert.ok(sections.includes('if (!ownershipFlags().ui'));
  assert.ok(sections.includes('if (!flags.enabled'));
  for (const f of ['src/app/(jury)/jury/phase1-sections.tsx', 'src/app/(jury)/jury/phase1-forms.tsx', 'src/lib/jury-product/services/phase1-text.ts']) {
    assert.ok(!/(습니다|십시오)/.test(readFileSync(f, 'utf8')), f);
  }
});
