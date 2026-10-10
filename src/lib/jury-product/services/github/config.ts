/**
 * GitHub App configuration stays in environment variables.
 * The private key is read only by the server client and is not part of the public configuration.
 */
import { providerError, type ProviderError } from '../provider-types';

export type GithubAppConfig = {
  appId: string;
  clientId: string | null;
  privateKey: string;
  appName: string;
  stateSecret: string;
};

export type PublicGithubConfiguration = {
  provider: 'GITHUB';
  configured: boolean;
  readOnly: true;
  permissions: ['metadata:read', 'contents:read'];
};

const APP_NAME = /^[A-Za-z0-9-]{1,100}$/;
const APP_ID = /^\d{1,12}$/;

function pem(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\n/g, '\n').trim();
  if (!normalized.includes('BEGIN') || !normalized.includes('PRIVATE KEY')) return null;
  return normalized;
}

export function readGithubAppConfig(
  env: Record<string, string | undefined> = process.env,
): { ok: true; config: GithubAppConfig } | ProviderError {
  const appId = env.GITHUB_APP_ID?.trim() ?? '';
  const appName = env.GITHUB_APP_NAME?.trim() ?? '';
  const stateSecret = env.GITHUB_APP_STATE_SECRET?.trim() ?? '';
  const privateKey = pem(env.GITHUB_APP_PRIVATE_KEY);
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim() || null;
  if (!APP_ID.test(appId) || !APP_NAME.test(appName) || stateSecret.length < 16 || !privateKey) {
    return providerError('GITHUB_NOT_CONFIGURED');
  }
  return {
    ok: true,
    config: { appId, clientId, privateKey, appName, stateSecret },
  };
}

export function publicGithubConfiguration(
  env: Record<string, string | undefined> = process.env,
): PublicGithubConfiguration {
  return {
    provider: 'GITHUB',
    configured: readGithubAppConfig(env).ok,
    readOnly: true,
    permissions: ['metadata:read', 'contents:read'],
  };
}

export function githubInstallUrl(appName: string, state: string): string | null {
  if (!APP_NAME.test(appName) || state.length === 0 || state.length > 2048) return null;
  return `https://github.com/apps/${appName}/installations/new?state=${encodeURIComponent(state)}`;
}
