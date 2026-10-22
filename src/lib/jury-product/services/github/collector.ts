/**
 * Read-only GitHub repository collection.
 * This module calls the GitHub API client and does not call Prisma or Jury Core.
 */
import { providerError, type ProviderError, type ProviderErrorCode } from '../provider-types';
import { githubProseContainsSecret } from './document-secret';
import {
  openGithubRead,
  type GithubCommitSummary,
  type GithubHttp,
  type GithubReadSession,
  type GithubRepositoryMetadata,
} from './client';
import type { GithubContentEntry } from './discovery';
import { GITHUB_EVIDENCE_LIMITS } from './permissions';

const NAME = /^[A-Za-z0-9._-]+$/;
export type GithubCollectionFailure = ProviderError & { status: 'FAILED' };

export type GithubSection<T> = {
  availability: 'AVAILABLE' | 'NOT_AVAILABLE' | 'COLLECTION_FAILED';
  code?: ProviderErrorCode;
  value: T;
};

export type GithubCollected = {
  status: 'COLLECTED' | 'PARTIAL';
  provider: 'GITHUB';
  source: 'github';
  connectionId: string;
  collectedAt: string;
  readOnly: true;
  repository: GithubRepositoryMetadata;
  readme: GithubSection<{ name: string | null; bytes: number | null; text: string | null }>;
  commits: GithubSection<GithubCommitSummary[]>;
  structure: GithubSection<GithubContentEntry[]>;
  requested: Array<'repository' | 'readme' | 'commits' | 'structure'>;
};

export type GithubCollectionResult =
  | { ok: true; collection: GithubCollected }
  | GithubCollectionFailure;

function failed(code: ProviderErrorCode): GithubCollectionFailure {
  const error = providerError(code);
  return { ok: false, code: error.code, message: error.message, status: 'FAILED' };
}

function safeText(value: string): string | null {
  const redacted = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[withheld]');
  if (githubProseContainsSecret(redacted)) return null;
  return redacted;
}

function excluded(path: string): boolean {
  if (path === '.git' || path.startsWith('.git/') || path.includes('/.git/')) return true;
  const base = path.split('/').pop()?.toLowerCase() ?? '';
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (base.endsWith('.pem') || base.endsWith('.key') || base.endsWith('.p12') || base.endsWith('.pfx')) return true;
  if (base === 'id_rsa' || base === 'id_dsa' || base === 'credentials.json') return true;
  return base.startsWith('service-account') && base.endsWith('.json');
}

function safePath(path: string): boolean {
  if (!path || path.includes('..') || path.includes('\\') || path.startsWith('/')) return false;
  return path.split('/').every((part) => NAME.test(part));
}

export async function collectRepositoryEvidence(input: {
  http?: GithubHttp;
  appId: string;
  privateKey: string;
  installationId: string;
  connectionId: string;
  allowedFullName: string;
  requestedFullName: string;
  collectedAt: string;
  nowSeconds?: number;
}): Promise<GithubCollectionResult> {
  if (input.requestedFullName !== input.allowedFullName) return failed('SCOPE_DENIED');
  const parts = input.allowedFullName.split('/');
  if (parts.length !== 2 || !NAME.test(parts[0] ?? '') || !NAME.test(parts[1] ?? '')) return failed('GITHUB_NOT_FOUND');
  const owner = parts[0] ?? '';
  const repo = parts[1] ?? '';
  const opened = await openGithubRead({
    http: input.http,
    appId: input.appId,
    privateKey: input.privateKey,
    installationId: input.installationId,
    nowSeconds: input.nowSeconds,
  });
  if (!opened.ok) return failed(opened.code);
  const metadata = await opened.read.metadata(owner, repo);
  if (!metadata.ok) return failed(metadata.code);
  if (metadata.repository.fullName !== input.allowedFullName) return failed('SCOPE_DENIED');

  const requested: GithubCollected['requested'] = ['repository'];
  let readme: GithubCollected['readme'] = {
    availability: 'NOT_AVAILABLE',
    value: { name: null, bytes: null, text: null },
  };
  let commits: GithubCollected['commits'] = { availability: 'NOT_AVAILABLE', value: [] };
  let structure: GithubCollected['structure'] = { availability: 'NOT_AVAILABLE', value: [] };
  let partial = false;
  const branch = metadata.repository.defaultBranch;

  if (!metadata.repository.disabled && branch) {
    requested.push('readme');
    const read = await opened.read.readme(owner, repo, branch);
    if (!read.ok) {
      if (read.code === 'GITHUB_UNAUTHORIZED') return failed(read.code);
      readme = { availability: 'COLLECTION_FAILED', code: read.code, value: { name: null, bytes: null, text: null } };
      partial = true;
      if (read.code === 'GITHUB_RATE_LIMIT') {
        return { ok: true, collection: finish(input, metadata.repository, requested, readme, commits, structure, true) };
      }
    } else if (!read.readme.available) {
      readme = { availability: 'NOT_AVAILABLE', value: { name: null, bytes: null, text: null } };
    } else {
      const text = safeText(read.readme.text);
      if (text === null) {
        readme = { availability: 'COLLECTION_FAILED', code: 'SECRET_REJECTED', value: { name: read.readme.name, bytes: null, text: null } };
        partial = true;
      } else {
        readme = {
          availability: 'AVAILABLE',
          value: { name: read.readme.name, bytes: read.readme.bytes, text },
        };
      }
    }

    if (readme.code !== 'GITHUB_RATE_LIMIT') {
      requested.push('commits');
      const listed = await opened.read.commits(owner, repo, branch);
      if (!listed.ok) {
        if (listed.code === 'GITHUB_UNAUTHORIZED') return failed(listed.code);
        commits = { availability: 'COLLECTION_FAILED', code: listed.code, value: [] };
        partial = true;
        if (listed.code === 'GITHUB_RATE_LIMIT') {
          return { ok: true, collection: finish(input, metadata.repository, requested, readme, commits, structure, true) };
        }
      } else if (!listed.measured) {
        commits = { availability: 'NOT_AVAILABLE', value: [] };
      } else {
        commits = {
          availability: 'AVAILABLE',
          value: listed.commits.map((commit) => ({
            ...commit,
            author: safeText(commit.author) === null ? 'unavailable' : commit.author,
            message: safeText(commit.message) ?? '',
          })),
        };
      }
    }

    if (commits.code !== 'GITHUB_RATE_LIMIT') {
      requested.push('structure');
      const walked = await walkStructure(opened.read, owner, repo, branch);
      structure = walked.section;
      if (walked.stop) return failed(walked.stop);
      if (structure.availability === 'COLLECTION_FAILED') partial = true;
    }
  }

  return { ok: true, collection: finish(input, metadata.repository, requested, readme, commits, structure, partial) };
}

function finish(
  input: { connectionId: string; collectedAt: string },
  repository: GithubRepositoryMetadata,
  requested: GithubCollected['requested'],
  readme: GithubCollected['readme'],
  commits: GithubCollected['commits'],
  structure: GithubCollected['structure'],
  partial: boolean,
): GithubCollected {
  return {
    status: partial || readme.code || commits.code || structure.code ? 'PARTIAL' : 'COLLECTED',
    provider: 'GITHUB',
    source: 'github',
    connectionId: input.connectionId,
    collectedAt: input.collectedAt,
    readOnly: true,
    repository,
    readme,
    commits,
    structure,
    requested,
  };
}

async function walkStructure(
  read: GithubReadSession,
  owner: string,
  repo: string,
  ref: string,
): Promise<{ section: GithubCollected['structure']; stop?: ProviderErrorCode }> {
  const entries: GithubContentEntry[] = [];
  const pending = [''];
  while (pending.length > 0) {
    const path = pending.shift() ?? '';
    const listed = await read.contents(owner, repo, path, ref);
    if (!listed.ok) {
      if (listed.code === 'GITHUB_UNAUTHORIZED' || listed.code === 'GITHUB_RATE_LIMIT') {
        return {
          section: { availability: 'COLLECTION_FAILED', code: listed.code, value: [] },
          stop: listed.code === 'GITHUB_UNAUTHORIZED' ? listed.code : undefined,
        };
      }
      return { section: { availability: 'COLLECTION_FAILED', code: listed.code, value: [] } };
    }
    for (const entry of listed.entries) {
      if (!safePath(entry.path) || excluded(entry.path) || githubProseContainsSecret(entry.path)) continue;
      entries.push(entry);
      const depth = entry.path.split('/').filter(Boolean).length;
      if (entry.type === 'dir' && depth < GITHUB_EVIDENCE_LIMITS.maxDepth) pending.push(entry.path);
      const total = entries.reduce((sum, item) => sum + item.size, 0);
      if (
        entries.length > GITHUB_EVIDENCE_LIMITS.maxFiles
        || entry.size > GITHUB_EVIDENCE_LIMITS.maxFileBytes
        || total > GITHUB_EVIDENCE_LIMITS.maxTotalBytes
      ) {
        return { section: { availability: 'COLLECTION_FAILED', code: 'COLLECTION_LIMIT_EXCEEDED', value: [] } };
      }
    }
  }
  return { section: { availability: 'AVAILABLE', value: entries } };
}
