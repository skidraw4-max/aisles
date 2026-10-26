import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JuryActor } from '../../access';
import { createTestKeyProvider, decryptAccountCredential } from './credential-crypto';
import { normalizeObservationScope, observationScopeHash, READONLY_ACCOUNT_AUDIT, READONLY_ACCOUNT_CONSENT_TEXT } from './consent';
import { persistReadonlyAccountConsent, persistReadonlyAccountCredential, type ReadonlyAccountStore } from './store';

const owner = { ok: true, userId: 'u1', tenantId: 't1', role: 'OWNER' } as JuryActor;
const viewer = { ok: true, userId: 'u2', tenantId: 't1', role: 'VIEWER' } as JuryActor;
const other = { ok: true, userId: 'u3', tenantId: 't2', role: 'OWNER' } as JuryActor;
const now = '2026-10-26T03:00:00.000Z';
const scopeInput = { allowedOrigins: ['https://app.example.com/x'], paths: ['/dashboard', '/dashboard'] };

function memoryStore(accessMethod = 'READ_ONLY_ACCOUNT') {
  const state = { consents: [] as any[], credentials: [] as any[], refs: [] as string[], audits: [] as any[] };
  const store: ReadonlyAccountStore = {
    async findConnection(tenantId, id) {
      return tenantId === 't1' && id === 'c1' ? { id: 'c1', tenantId: 't1', serviceKey: 'svc', accessMethod } : null;
    },
    async findLatestConsent() {
      return state.consents.at(-1) ?? null;
    },
    async createConsent(row) {
      state.consents.push(row);
    },
    async replaceCredential(row, ref) {
      state.credentials.push(row);
      state.refs.push(ref);
    },
    async audit(event) {
      state.audits.push(event);
    },
  };
  return { store, state };
}

test('consent text states no permission restriction but warns about impact', () => {
  const text = READONLY_ACCOUNT_CONSENT_TEXT.join('\n');
  assert.match(text, /권한 수준과 관계없이/);
  assert.match(text, /영향이 커질 수 있습니다/);
  assert.match(text, /최소 권한 계정 사용을 권장/);
});

test('scope normalization requires https origins and absolute paths', () => {
  const ok = normalizeObservationScope(scopeInput);
  assert.deepEqual(ok, { ok: true, scope: { allowedOrigins: ['https://app.example.com'], paths: ['/dashboard'] } });
  assert.equal(normalizeObservationScope({ allowedOrigins: ['http://a.com'], paths: ['/'] }).ok, false);
  assert.equal(normalizeObservationScope({ allowedOrigins: ['https://u:p@a.com'], paths: ['/'] }).ok, false);
  assert.equal(normalizeObservationScope({ allowedOrigins: ['https://a.com'], paths: ['//evil'] }).ok, false);
});

test('consent is required, gated by connection.write and tenant', async () => {
  const { store, state } = memoryStore();
  assert.deepEqual(await persistReadonlyAccountConsent({ actor: owner, connectionId: 'c1', scope: scopeInput, accepted: false, now, store }), { ok: false, reason: 'CONSENT_REQUIRED' });
  assert.deepEqual(await persistReadonlyAccountConsent({ actor: viewer, connectionId: 'c1', scope: scopeInput, accepted: true, now, store }), { ok: false, reason: 'FORBIDDEN' });
  assert.deepEqual(await persistReadonlyAccountConsent({ actor: other, connectionId: 'c1', scope: scopeInput, accepted: true, now, store }), { ok: false, reason: 'NOT_FOUND' });
  assert.equal(state.consents.length, 0);
  const res = await persistReadonlyAccountConsent({ actor: owner, connectionId: 'c1', scope: scopeInput, accepted: true, now, store });
  assert.equal(res.ok, true);
  assert.equal(state.consents[0].userId, 'u1');
  assert.equal(state.audits[0].action, READONLY_ACCOUNT_AUDIT.CONSENT_ACCEPTED);
});

test('non READ_ONLY_ACCOUNT connections are rejected', async () => {
  const { store } = memoryStore('GITHUB_APP');
  assert.deepEqual(await persistReadonlyAccountConsent({ actor: owner, connectionId: 'c1', scope: scopeInput, accepted: true, now, store }), { ok: false, reason: 'ACCESS_METHOD_UNSUPPORTED' });
});

test('credential storage needs matching consent and stores only ciphertext with a pointer ref', async () => {
  const { store, state } = memoryStore();
  const keyProvider = createTestKeyProvider();
  const scope = (normalizeObservationScope(scopeInput) as { ok: true; scope: any }).scope;
  const base = { actor: owner, connectionId: 'c1', scope, username: 'alice@example.com', password: 'pw-123456', now, keyProvider, store };
  assert.deepEqual(await persistReadonlyAccountCredential(base), { ok: false, reason: 'CONSENT_REQUIRED' });
  await persistReadonlyAccountConsent({ actor: owner, connectionId: 'c1', scope: scopeInput, accepted: true, now, store });
  assert.deepEqual(await persistReadonlyAccountCredential({ ...base, scope: { ...scope, paths: ['/other'] } }), { ok: false, reason: 'CONSENT_STALE' });
  assert.deepEqual(await persistReadonlyAccountCredential({ ...base, retentionDays: 30 }), { ok: false, reason: 'RETENTION_INVALID' });
  assert.deepEqual(await persistReadonlyAccountCredential({ ...base, password: '' }), { ok: false, reason: 'CREDENTIAL_INVALID' });
  const res = await persistReadonlyAccountCredential(base);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.expiresAt, '2026-11-09T03:00:00.000Z');
  const row = state.credentials[0];
  const serialized = JSON.stringify({ row, audits: state.audits, refs: state.refs });
  assert.doesNotMatch(serialized, /pw-123456|alice@example\.com/);
  assert.match(state.refs[0], /^secret-store\/account\//);
  assert.equal(state.audits.at(-1).action, READONLY_ACCOUNT_AUDIT.CREDENTIAL_STORED);
  const plain = await decryptAccountCredential(row, { tenantId: 't1', connectionId: 'c1' }, keyProvider);
  assert.deepEqual(plain, { ok: true, secret: { username: 'alice@example.com', password: 'pw-123456' } });
  assert.equal(observationScopeHash(scope), state.consents[0].scopeHash);
});
