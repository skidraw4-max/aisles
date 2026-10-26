/**
 * I-042: production key provider adapter.
 * Reads the KEK from an environment variable referenced by NAME only. The value is never logged, returned or
 * included in errors. When the variable is absent or malformed the adapter reports NOT_CONFIGURED and nothing is
 * wired: callers must treat that as "feature unavailable". Replace with a KMS-backed provider when chosen.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { CredentialKeyProvider } from './credential-crypto';

export const READONLY_ACCOUNT_KEK_ENV = 'JURY_ACCOUNT_CREDENTIAL_KEK';
export const READONLY_ACCOUNT_KEK_ID_ENV = 'JURY_ACCOUNT_CREDENTIAL_KEK_ID';

export type KeyProviderResolution = { ok: true; provider: CredentialKeyProvider } | { ok: false; reason: 'NOT_CONFIGURED' };

type EnvReader = (name: string) => string | undefined;
const processEnv: EnvReader = (name) => process.env[name];

/** Expects a base64 encoded 32-byte key. kekId defaults to 'env-kek-v1'. */
export function resolveEnvKeyProvider(readEnv: EnvReader = processEnv): KeyProviderResolution {
  const raw = readEnv(READONLY_ACCOUNT_KEK_ENV)?.trim();
  if (!raw) return { ok: false, reason: 'NOT_CONFIGURED' };
  let kek: Buffer;
  try {
    kek = Buffer.from(raw, 'base64');
  } catch {
    return { ok: false, reason: 'NOT_CONFIGURED' };
  }
  if (kek.length !== 32) {
    kek.fill(0);
    return { ok: false, reason: 'NOT_CONFIGURED' };
  }
  const kekId = readEnv(READONLY_ACCOUNT_KEK_ID_ENV)?.trim() || 'env-kek-v1';
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(kekId)) return { ok: false, reason: 'NOT_CONFIGURED' };
  const provider: CredentialKeyProvider = {
    kekId,
    async wrapKey(dek) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', kek, iv);
      cipher.setAAD(Buffer.from(`jury-kek:${kekId}`));
      const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
      return [iv, cipher.getAuthTag(), wrapped].map((p) => p.toString('base64')).join('.');
    },
    async unwrapKey(wrappedDek, id) {
      if (id !== kekId) throw new Error('KEY_PROVIDER_MISMATCH');
      const parts = wrappedDek.split('.');
      if (parts.length !== 3) throw new Error('WRAPPED_KEY_INVALID');
      const [iv, tag, wrapped] = parts.map((p) => Buffer.from(p, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', kek, iv);
      decipher.setAAD(Buffer.from(`jury-kek:${kekId}`));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(wrapped), decipher.final()]);
    },
  };
  return { ok: true, provider };
}
