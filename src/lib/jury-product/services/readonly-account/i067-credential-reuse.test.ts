import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { JuryActor } from '../../access';
import { normalizeObservationScope, observationScopeHash } from './consent';
import { READONLY_ACCOUNT_CONSENT_VERSION } from './consent-text';
import { createTestKeyProvider, decryptAccountCredential, encryptAccountCredential } from './credential-crypto';
import type { StoredCredentialRecord } from './observation-run';
import { persistReadonlyAccountConsent, persistReadonlyAccountCredential, type ReadonlyAccountStore } from './store';

const owner = { ok: true, userId: 'u1', tenantId: 't1', role: 'OWNER' } as JuryActor;
const ctx = { tenantId: 't1', connectionId: 'c1' };
const scope = (normalizeObservationScope({ allowedOrigins: ['https://app.example.com'], paths: ['/'] }) as { ok: true; scope: { allowedOrigins: string[]; paths: string[] } }).scope;
const login = { loginUrl: 'https://app.example.com/login', usernameSelector: '#login_id', passwordSelector: '#login_pw', submitSelector: 'button', successPathPrefix: '/' };
const NOW = '2026-10-27T00:00:00.000Z';
const consent = { id: 'k1', connectionId: 'c1', tenantId: 't1', version: READONLY_ACCOUNT_CONSENT_VERSION, scopeHash: observationScopeHash(scope), scope, loginSettings: login };

async function setup(opts: { stored?: boolean; expiresAt?: string; destroyed?: boolean } = {}) {
  const keys = createTestKeyProvider();
  let active: StoredCredentialRecord | null = null;
  if (opts.stored !== false) {
    const enc = await encryptAccountCredential({ username: 'olduser', password: 'oldpass' }, ctx, keys);
    const { usernameHint: _h, ...rest } = enc;
    active = { ...rest, expiresAt: new Date(opts.expiresAt ?? '2026-11-09T00:00:00.000Z'), destroyedAt: opts.destroyed ? new Date(NOW) : null };
  }
  const replaced: Record<string, unknown>[] = [];
  const created: Record<string, unknown>[] = [];
  const store: ReadonlyAccountStore = {
    async findConnection(tenantId, id) { return tenantId === 't1' && id === 'c1' ? { id, tenantId, serviceKey: 'svc', accessMethod: 'READ_ONLY_ACCOUNT' } : null; },
    async findLatestConsent() { return consent; },
    async createConsent(row) { created.push(row); },
    async replaceCredential(row) { replaced.push(row); },
    async audit() {},
    async saveLoginSettings() {},
    async findActiveCredential(t, c) { return t === 't1' && c === 'c1' ? active : null; },
  };
  const save = (username: string, password: string) =>
    persistReadonlyAccountCredential({ actor: owner, connectionId: 'c1', scope: null, username, password, login, now: NOW, keyProvider: keys, store });
  const savedSecret = async () => {
    const r = replaced[replaced.length - 1] as never as Parameters<typeof decryptAccountCredential>[0];
    const d = await decryptAccountCredential(r, ctx, keys);
    assert.equal(d.ok, true);
    return (d as { ok: true; secret: { username: string; password: string } }).secret;
  };
  return { save, savedSecret, replaced, created, store };
}

test('I-067: blank ID reuses the stored ID with the new password', async () => {
  const s = await setup();
  const r = await s.save('', 'newpass');
  assert.equal(r.ok, true);
  assert.deepEqual(await s.savedSecret(), { username: 'olduser', password: 'newpass' });
  assert.doesNotMatch(JSON.stringify(r), /olduser|oldpass|newpass/);
});

test('I-067: blank password reuses the stored password with the new ID', async () => {
  const s = await setup();
  assert.equal((await s.save('newuser', '')).ok, true);
  assert.deepEqual(await s.savedSecret(), { username: 'newuser', password: 'oldpass' });
});

test('I-067: nothing stored, expired or destroyed keeps CREDENTIAL_INVALID', async () => {
  for (const opts of [{ stored: false }, { expiresAt: '2026-10-26T00:00:00.000Z' }, { destroyed: true }]) {
    const s = await setup(opts);
    assert.deepEqual(await s.save('', 'newpass'), { ok: false, reason: 'CREDENTIAL_INVALID' });
    assert.deepEqual(await s.save('newuser', ''), { ok: false, reason: 'CREDENTIAL_INVALID' });
    assert.equal(s.replaced.length, 0);
  }
});

test('I-067: re-consent carries the previous login settings (selectors only)', async () => {
  const s = await setup();
  const r = await persistReadonlyAccountConsent({ actor: owner, connectionId: 'c1', scope: { allowedOrigins: ['https://app.example.com'], paths: ['/'] }, accepted: true, now: NOW, store: s.store });
  assert.equal(r.ok, true);
  assert.deepEqual(s.created[0]!.loginSettings, login);
  assert.doesNotMatch(JSON.stringify(s.created[0]), /olduser|oldpass/);
});

test('I-067: help text says blank ID and blank password reuse the stored values', () => {
  const src = readFileSync('src/app/(jury)/jury/ReadOnlyAccountCredentialForm.tsx', 'utf8');
  assert.match(src, /비워 두면 저장된 아이디\(\$\{stored\.usernameHint\}\)를 그대로 써요/);
  assert.match(src, /비워 두면 저장된 비밀번호를 그대로 써요/);
});
