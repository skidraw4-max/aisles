/**
 * GitHub App repository permissions for this phase.
 * Metadata read is the GitHub App default. Contents read is the only extra permission requested.
 * Issues, pull requests, administration, actions, secrets, deployments, members, and organization
 * administration are not requested.
 */
export const GITHUB_APP_REPOSITORY_PERMISSIONS = {
  metadata: 'read',
  contents: 'read',
} as const;

export const GITHUB_TOKEN_PERMISSIONS = {
  contents: 'read',
} as const;

export const GITHUB_CONTENT_LIMITS = {
  maxFiles: 50,
  maxFileBytes: 100_000,
  maxTotalBytes: 500_000,
  maxDepth: 2,
} as const;

export const GITHUB_MAX_RETRIES = 2;
export const GITHUB_MAX_REPOSITORY_PAGES = 2;

export const GITHUB_EVIDENCE_LIMITS = {
  maxFiles: 100,
  maxFileBytes: GITHUB_CONTENT_LIMITS.maxFileBytes,
  maxTotalBytes: GITHUB_CONTENT_LIMITS.maxTotalBytes,
  maxDepth: GITHUB_CONTENT_LIMITS.maxDepth,
  maxCommits: 20,
  maxCommitMessageLength: 500,
  maxReadmeBytes: GITHUB_CONTENT_LIMITS.maxFileBytes,
} as const;
