/**
 * GitHub document text check.
 * Ordinary words such as token or password stay. Credential-shaped values do not.
 */
const SHAPE = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /begin private/i,
  /postgres:\/\//i,
  /credentialref/i,
  /sessioncookie/i,
  /FAKE_GITHUB_(?:TOKEN|PRIVATE_KEY|SECRET)_80_1[5-8]/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/,
  /github_pat_[A-Za-z0-9_]{16,}/,
];

const PLACEHOLDER = /^(?:token|secret|password|key|example|placeholder|changeme|none|null|undefined|your[-_]?token|xxx+|redacted|withheld|\[[^\]]+\]|<[^>]+>|\$[A-Za-z0-9_]+)$/i;
const ASSIGNED = /\b(?:ACCESS_TOKEN|REFRESH_TOKEN|API_KEY|CLIENT_SECRET|PRIVATE_KEY|PASSWORD|TOKEN|SECRET)\b\s*[:=]\s*['"]?([^\s'",}]+)/gi;
const HEADER = /authorization\s*:\s*(?:bearer|token|basic)\s+['"]?([^\s'",}]+)/gi;
const JSON_VALUE = /"(?:access_token|refresh_token|api_key|client_secret|private_key)"\s*:\s*"([^"]*)"/gi;

function assigned(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[1] ?? '';
    if (value.length > 0 && !PLACEHOLDER.test(value)) return true;
  }
  return false;
}

export function githubProseContainsSecret(value: string): boolean {
  if (SHAPE.some((pattern) => pattern.test(value))) return true;
  return assigned(ASSIGNED, value) || assigned(HEADER, value) || assigned(JSON_VALUE, value);
}

export function githubPayloadHasSecret(value: unknown): boolean {
  const text = JSON.stringify(value);
  if (!text) return false;
  return githubProseContainsSecret(text);
}
