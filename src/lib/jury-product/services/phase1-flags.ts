/**
 * I-072: Phase 1 feature flags. Env-driven, default OFF.
 * A flag is only "on" when every env var it needs is present; a missing env never turns anything on.
 * Values are read but never logged or returned.
 */
export type EnvLike = Record<string, string | undefined>;

const isOn = (v: string | undefined) => v === 'true' || v === '1';
const present = (v: string | undefined) => typeof v === 'string' && v.trim().length > 0;

export const OWNERSHIP_PEPPER_MIN_LENGTH = 32;

export type OwnershipFlags = {
  /** Ownership UI + token issuing/checking. */
  ui: boolean;
  /** Gate start. Null = no enforcement. Only connections created at/after this instant are gated. */
  enforceFrom: Date | null;
};

export function ownershipFlags(env: EnvLike = process.env): OwnershipFlags {
  const pepperOk = present(env.JURY_OWNERSHIP_TOKEN_PEPPER) && (env.JURY_OWNERSHIP_TOKEN_PEPPER ?? '').length >= OWNERSHIP_PEPPER_MIN_LENGTH;
  const ui = isOn(env.JURY_OWNERSHIP_UI_ENABLED) && pepperOk;
  let enforceFrom: Date | null = null;
  if (ui && present(env.JURY_OWNERSHIP_ENFORCE_FROM)) {
    const d = new Date(String(env.JURY_OWNERSHIP_ENFORCE_FROM).trim());
    enforceFrom = Number.isNaN(d.getTime()) ? null : d;
  }
  return { ui, enforceFrom };
}

export type Ga4CredentialMode = 'WIF' | 'JSON_KEY' | 'NONE';

/** WIF wins when all its vars exist; otherwise a JSON key; otherwise NONE. */
export function ga4CredentialMode(env: EnvLike = process.env): Ga4CredentialMode {
  if (!present(env.JURY_GA4_SA_EMAIL)) return 'NONE';
  if (present(env.JURY_GA4_WIF_PROJECT_NUMBER) && present(env.JURY_GA4_WIF_POOL_ID) && present(env.JURY_GA4_WIF_PROVIDER_ID)) return 'WIF';
  if (present(env.JURY_GA4_SA_KEY_JSON_BASE64)) return 'JSON_KEY';
  return 'NONE';
}

export type Ga4ViewerFlags = { enabled: boolean; mode: Ga4CredentialMode; serviceAccountEmail: string | null };

export function ga4ViewerFlags(env: EnvLike = process.env): Ga4ViewerFlags {
  const mode = ga4CredentialMode(env);
  const enabled = isOn(env.JURY_GA4_VIEWER_ENABLED) && mode !== 'NONE';
  return { enabled, mode, serviceAccountEmail: enabled ? String(env.JURY_GA4_SA_EMAIL).trim() : null };
}
