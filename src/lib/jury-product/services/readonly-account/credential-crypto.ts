/**
 * I-039: envelope encryption for READ_ONLY_ACCOUNT credentials.
 * A fresh data key (DEK, AES-256-GCM) encrypts the credential; a key provider wraps the DEK.
 * The key provider is pluggable. Phase 1 ships only an in-memory test provider; a production KMS
 * provider needs separate approval. Plaintext never leaves this module except through `decryptAccountCredential`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const ACCOUNT_CREDENTIAL_ALGORITHM = 'AES-256-GCM+wrapped-dek-v1';

export type AccountCredentialSecret = { username: string; password: string };

export interface CredentialKeyProvider {
  readonly kekId: string;
  wrapKey(dek: Buffer): Promise<string>;
  unwrapKey(wrappedDek: string, kekId: string): Promise<Buffer>;
}

export type EncryptedAccountCredential = {
  algorithm: typeof ACCOUNT_CREDENTIAL_ALGORITHM;
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedDek: string;
  kekId: string;
  usernameHint: string;
};

export type CredentialCryptoError =
  | 'CREDENTIAL_INVALID'
  | 'CREDENTIAL_DECRYPT_FAILED'
  | 'KEY_PROVIDER_MISMATCH';

const MAX_FIELD = 512;

function aad(context: { tenantId: string; connectionId: string }): Buffer {
  return Buffer.from(`jury-account-credential:${context.tenantId}:${context.connectionId}`, 'utf8');
}

export function maskUsername(username: string): string {
  const value = username.trim();
  const at = value.indexOf('@');
  const local = at >= 0 ? value.slice(0, at) : value;
  const visible = local.slice(0, Math.min(3, Math.max(1, local.length - 1)));
  return `${visible}***${at >= 0 ? '@' : ''}`;
}

export function validateAccountCredential(
  input: { username?: unknown; password?: unknown },
): { ok: true; secret: AccountCredentialSecret } | { ok: false; reason: 'CREDENTIAL_INVALID' } {
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!username || !password || username.length > MAX_FIELD || password.length > MAX_FIELD) {
    return { ok: false, reason: 'CREDENTIAL_INVALID' };
  }
  return { ok: true, secret: { username, password } };
}

export async function encryptAccountCredential(
  secret: AccountCredentialSecret,
  context: { tenantId: string; connectionId: string },
  provider: CredentialKeyProvider,
): Promise<EncryptedAccountCredential> {
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(aad(context));
    const plaintext = Buffer.from(JSON.stringify(secret), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    plaintext.fill(0);
    return {
      algorithm: ACCOUNT_CREDENTIAL_ALGORITHM,
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      wrappedDek: await provider.wrapKey(dek),
      kekId: provider.kekId,
      usernameHint: maskUsername(secret.username),
    };
  } finally {
    dek.fill(0);
  }
}

/** Only the observation executor (later phase) may call this. */
export async function decryptAccountCredential(
  record: Omit<EncryptedAccountCredential, 'usernameHint'>,
  context: { tenantId: string; connectionId: string },
  provider: CredentialKeyProvider,
): Promise<{ ok: true; secret: AccountCredentialSecret } | { ok: false; reason: CredentialCryptoError }> {
  if (record.algorithm !== ACCOUNT_CREDENTIAL_ALGORITHM) return { ok: false, reason: 'CREDENTIAL_DECRYPT_FAILED' };
  if (record.kekId !== provider.kekId) return { ok: false, reason: 'KEY_PROVIDER_MISMATCH' };
  let dek: Buffer | null = null;
  try {
    dek = await provider.unwrapKey(record.wrappedDek, record.kekId);
    const decipher = createDecipheriv('aes-256-gcm', dek, Buffer.from(record.iv, 'base64'));
    decipher.setAAD(aad(context));
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as { username?: unknown; password?: unknown };
    plaintext.fill(0);
    const valid = validateAccountCredential(parsed);
    return valid.ok ? valid : { ok: false, reason: 'CREDENTIAL_DECRYPT_FAILED' };
  } catch {
    return { ok: false, reason: 'CREDENTIAL_DECRYPT_FAILED' };
  } finally {
    dek?.fill(0);
  }
}

/** In-memory key provider for tests and local runs only. The key exists only for the process lifetime. */
export function createTestKeyProvider(kekId = 'test-kek-v1'): CredentialKeyProvider {
  const kek = randomBytes(32);
  return {
    kekId,
    async wrapKey(dek: Buffer): Promise<string> {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', kek, iv);
      const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
      return [iv, cipher.getAuthTag(), wrapped].map((part) => part.toString('base64')).join('.');
    },
    async unwrapKey(wrappedDek: string, id: string): Promise<Buffer> {
      if (id !== kekId) throw new Error('KEY_PROVIDER_MISMATCH');
      const [iv, tag, wrapped] = wrappedDek.split('.').map((part) => Buffer.from(part, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', kek, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(wrapped), decipher.final()]);
    },
  };
}

export function accountCredentialRef(credentialId: string): string {
  return `secret-store/account/${credentialId}`;
}
