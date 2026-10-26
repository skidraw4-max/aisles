import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accountCredentialRef,
  createTestKeyProvider,
  decryptAccountCredential,
  encryptAccountCredential,
  maskUsername,
  validateAccountCredential,
} from './credential-crypto';
import { containsRawCredential } from '../provider-types';

const ctx = { tenantId: 'tenant-a', connectionId: 'conn-1' };
const secret = { username: 'reviewer@example.test', password: 'mock-Pass-0001' };

test('round trip with the test key provider', async () => {
  const provider = createTestKeyProvider();
  const enc = await encryptAccountCredential(secret, ctx, provider);
  const dec = await decryptAccountCredential(enc, ctx, provider);
  assert.deepEqual(dec, { ok: true, secret });
});

test('stored record never contains plaintext', async () => {
  const enc = await encryptAccountCredential(secret, ctx, createTestKeyProvider());
  const json = JSON.stringify(enc);
  assert.doesNotMatch(json, /mock-Pass-0001/);
  assert.doesNotMatch(json, /reviewer@example\.test/);
  assert.equal(enc.usernameHint, 'rev***@');
});

test('ciphertext is bound to tenant and connection', async () => {
  const provider = createTestKeyProvider();
  const enc = await encryptAccountCredential(secret, ctx, provider);
  assert.deepEqual(await decryptAccountCredential(enc, { ...ctx, tenantId: 'tenant-b' }, provider), { ok: false, reason: 'CREDENTIAL_DECRYPT_FAILED' });
  assert.deepEqual(await decryptAccountCredential(enc, { ...ctx, connectionId: 'conn-2' }, provider), { ok: false, reason: 'CREDENTIAL_DECRYPT_FAILED' });
});

test('tampering and wrong key provider fail closed', async () => {
  const provider = createTestKeyProvider();
  const enc = await encryptAccountCredential(secret, ctx, provider);
  const flipped = Buffer.from(enc.ciphertext, 'base64');
  flipped[0] ^= 1;
  assert.equal((await decryptAccountCredential({ ...enc, ciphertext: flipped.toString('base64') }, ctx, provider)).ok, false);
  assert.deepEqual(await decryptAccountCredential(enc, ctx, createTestKeyProvider('other-kek')), { ok: false, reason: 'KEY_PROVIDER_MISMATCH' });
  assert.deepEqual(await decryptAccountCredential(enc, ctx, createTestKeyProvider()), { ok: false, reason: 'CREDENTIAL_DECRYPT_FAILED' });
});

test('each encryption uses a fresh data key and iv', async () => {
  const provider = createTestKeyProvider();
  const a = await encryptAccountCredential(secret, ctx, provider);
  const b = await encryptAccountCredential(secret, ctx, provider);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.notEqual(a.wrappedDek, b.wrappedDek);
});

test('validation and helpers', () => {
  assert.deepEqual(validateAccountCredential({ username: ' ', password: 'x' }), { ok: false, reason: 'CREDENTIAL_INVALID' });
  assert.deepEqual(validateAccountCredential({ username: 'a', password: '' }), { ok: false, reason: 'CREDENTIAL_INVALID' });
  assert.equal(validateAccountCredential({ username: 'a', password: 'x'.repeat(513) }).ok, false);
  assert.equal(maskUsername('ab'), 'a***');
  const ref = accountCredentialRef('cred-1');
  assert.equal(ref, 'secret-store/account/cred-1');
  assert.equal(containsRawCredential(ref), false);
});
