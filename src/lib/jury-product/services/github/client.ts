/**
 * Read-only GitHub App client.
 * Installation access tokens and app JWTs stay inside this module.
 */
import { createSign } from 'node:crypto';
import {
  providerError,
  type ConnectionHealth,
  type ProviderError,
} from '../provider-types';
import type { GithubContentEntry, GithubRepository } from './discovery';
import {
  GITHUB_CONTENT_LIMITS,
  GITHUB_EVIDENCE_LIMITS,
  GITHUB_MAX_REPOSITORY_PAGES,
  GITHUB_MAX_RETRIES,
  GITHUB_TOKEN_PERMISSIONS,
} from './permissions';

export type GithubHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type GithubHttp = (request: {
  method: 'GET' | 'POST';
  url: string;
  authorization: string;
  body?: unknown;
}) => Promise<GithubHttpResponse>;

export type GithubRateLimit = {
  remaining: number | null;
  limit: number | null;
};

export type GithubFailure = ProviderError & { health: ConnectionHealth };

const API = 'https://api.github.com';
const NAME = /^[A-Za-z0-9._-]+$/;
const REF = /^[A-Za-z0-9._/-]+$/;

function githubHealthForStatus(status: number): ConnectionHealth {
  if (status === 403 || status === 429) return 'DEGRADED';
  if (status >= 200 && status < 300) return 'HEALTHY';
  return 'FAILED';
}

function statusError(status: number): GithubFailure {
  if (status === 401) return { ...providerError('GITHUB_UNAUTHORIZED'), health: githubHealthForStatus(status) };
  if (status === 403) return { ...providerError('GITHUB_FORBIDDEN'), health: githubHealthForStatus(status) };
  if (status === 404) return { ...providerError('GITHUB_NOT_FOUND'), health: githubHealthForStatus(status) };
  if (status === 429) return { ...providerError('GITHUB_RATE_LIMIT'), health: githubHealthForStatus(status) };
  if (status >= 500) return { ...providerError('GITHUB_UNAVAILABLE'), health: githubHealthForStatus(status) };
  return { ...providerError('GITHUB_UNAVAILABLE'), health: 'FAILED' };
}

function rateLimit(headers: Record<string, string>): GithubRateLimit {
  const remaining = Number(headers['x-ratelimit-remaining']);
  const limit = Number(headers['x-ratelimit-limit']);
  return {
    remaining: Number.isFinite(remaining) ? remaining : null,
    limit: Number.isFinite(limit) ? limit : null,
  };
}

function appJwt(appId: string, privateKey: string, nowSeconds: number): string | null {
  try {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 540,
      iss: appId,
    })).toString('base64url');
    const data = `${header}.${payload}`;
    const sign = createSign('RSA-SHA256');
    sign.update(data);
    sign.end();
    return `${data}.${sign.sign(privateKey).toString('base64url')}`;
  } catch {
    return null;
  }
}

function allowed(method: 'GET' | 'POST', url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== API || parsed.username || parsed.password) return false;
  if (method === 'POST') {
    return /^\/app\/installations\/\d{1,12}\/access_tokens$/.test(parsed.pathname) && parsed.search.length === 0;
  }
  if (/^\/app\/installations\/\d{1,12}$/.test(parsed.pathname)) return true;
  if (parsed.pathname === '/installation/repositories') return true;
  const kind = repositoryRead(parsed.pathname);
  return kind !== null && queryAllowed(kind, parsed.search);
}

function repositoryRead(pathname: string): 'repo' | 'readme' | 'commits' | 'contents' | null {
  if (/^\/repos\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/contents(?:\/|$)/.test(pathname)) return 'contents';
  if (/^\/repos\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/readme$/.test(pathname)) return 'readme';
  if (/^\/repos\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/commits$/.test(pathname)) return 'commits';
  if (/^\/repos\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(pathname)) return 'repo';
  return null;
}

function queryAllowed(kind: 'repo' | 'readme' | 'commits' | 'contents', search: string): boolean {
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (kind === 'repo') return keys.length === 0;
  if (kind === 'contents' || kind === 'readme') {
    return keys.length === 0 || (keys.length === 1 && keys[0] === 'ref' && Boolean(params.get('ref')));
  }
  if (params.get('per_page') !== '20') return false;
  return keys.every((key) => key === 'per_page' || key === 'sha');
}

async function callGithub(input: {
  http: GithubHttp;
  method: 'GET' | 'POST';
  url: string;
  authorization: string;
  body?: unknown;
}): Promise<GithubHttpResponse | GithubFailure> {
  if (!allowed(input.method, input.url)) return { ...providerError('READ_ACCESS_REQUIRED'), health: 'FAILED' };
  let attempt = 0;
  let response: GithubHttpResponse;
  do {
    response = await input.http({
      method: input.method,
      url: input.url,
      authorization: input.authorization,
      body: input.body,
    });
    if (response.status < 500 || attempt >= GITHUB_MAX_RETRIES) break;
    attempt += 1;
  } while (attempt <= GITHUB_MAX_RETRIES);
  return response;
}

async function installationToken(input: {
  http: GithubHttp;
  appId: string;
  privateKey: string;
  installationId: string;
  nowSeconds: number;
}): Promise<{ ok: true; authorization: string } | GithubFailure> {
  const jwt = appJwt(input.appId, input.privateKey, input.nowSeconds);
  if (!jwt) return { ...providerError('GITHUB_NOT_CONFIGURED'), health: 'FAILED' };
  const response = await callGithub({
    http: input.http,
    method: 'POST',
    url: `${API}/app/installations/${input.installationId}/access_tokens`,
    authorization: jwt,
    body: { permissions: GITHUB_TOKEN_PERMISSIONS },
  });
  if ('ok' in response) return response;
  if (response.status !== 201) return statusError(response.status);
  const token = response.body && typeof response.body === 'object' ? (response.body as { token?: unknown }).token : null;
  if (typeof token !== 'string' || token.length === 0) return { ...providerError('GITHUB_UNAUTHORIZED'), health: 'FAILED' };
  return { ok: true, authorization: token };
}

function mapRepository(raw: unknown): GithubRepository | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const owner = row.owner && typeof row.owner === 'object' ? (row.owner as { login?: unknown }).login : null;
  if (typeof row.id !== 'number' || typeof row.name !== 'string' || typeof row.full_name !== 'string' || typeof owner !== 'string') {
    return null;
  }
  if (!NAME.test(owner) || !NAME.test(row.name) || row.full_name !== `${owner}/${row.name}`) return null;
  const visibility = row.visibility === 'public' || row.visibility === 'private' || row.visibility === 'internal'
    ? row.visibility
    : row.private === true ? 'private' : 'public';
  const htmlUrl = typeof row.html_url === 'string' && row.html_url.startsWith('https://github.com/') ? row.html_url : '';
  return {
    id: row.id,
    owner,
    name: row.name,
    fullName: row.full_name,
    private: row.private === true,
    defaultBranch: typeof row.default_branch === 'string' && REF.test(row.default_branch) ? row.default_branch : 'main',
    archived: row.archived === true,
    disabled: row.disabled === true,
    htmlUrl,
    visibility,
  };
}

export async function githubFetch(request: {
  method: 'GET' | 'POST';
  url: string;
  authorization: string;
  body?: unknown;
}): Promise<GithubHttpResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'AIsles-Jury',
      Authorization: `Bearer ${request.authorization}`,
      ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  const headers: Record<string, string> = {};
  for (const key of ['x-ratelimit-remaining', 'x-ratelimit-limit']) {
    const value = response.headers.get(key);
    if (value) headers[key] = value;
  }
  return { status: response.status, headers, body };
}

export async function confirmInstallationAccess(input: {
  http?: GithubHttp;
  appId: string;
  privateKey: string;
  installationId: string;
  nowSeconds?: number;
}): Promise<{
  ok: true;
  accountLogin: string;
  accountType: string;
  appId: string;
  repositories: GithubRepository[];
  incomplete: boolean;
  rateLimit: GithubRateLimit;
} | GithubFailure> {
  if (!/^\d{1,12}$/.test(input.installationId) || !/^\d{1,12}$/.test(input.appId)) {
    return { ...providerError('GITHUB_NOT_CONFIGURED'), health: 'FAILED' };
  }
  const http = input.http ?? githubFetch;
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const jwt = appJwt(input.appId, input.privateKey, nowSeconds);
  if (!jwt) return { ...providerError('GITHUB_NOT_CONFIGURED'), health: 'FAILED' };
  const installation = await callGithub({
    http,
    method: 'GET',
    url: `${API}/app/installations/${input.installationId}`,
    authorization: jwt,
  });
  if ('ok' in installation) return installation;
  if (installation.status !== 200) return statusError(installation.status);
  const body = installation.body;
  if (!body || typeof body !== 'object') return { ...providerError('DISCOVERY_FAILED'), health: 'FAILED' };
  const row = body as { app_id?: unknown; account?: { login?: unknown; type?: unknown } };
  if (String(row.app_id ?? '') !== input.appId) return { ...providerError('GITHUB_FORBIDDEN'), health: 'DEGRADED' };
  const accountLogin = typeof row.account?.login === 'string' ? row.account.login : '';
  const accountType = typeof row.account?.type === 'string' ? row.account.type : 'unknown';
  const token = await installationToken({
    http,
    appId: input.appId,
    privateKey: input.privateKey,
    installationId: input.installationId,
    nowSeconds,
  });
  if (!token.ok) return token;
  const repositories: GithubRepository[] = [];
  let incomplete = false;
  let observed = rateLimit({});
  for (let page = 1; page <= GITHUB_MAX_REPOSITORY_PAGES; page += 1) {
    const listed = await callGithub({
      http,
      method: 'GET',
      url: `${API}/installation/repositories?per_page=100&page=${page}`,
      authorization: token.authorization,
    });
    if ('ok' in listed) return listed;
    if (listed.status !== 200) return statusError(listed.status);
    observed = rateLimit(listed.headers);
    const payload = listed.body;
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { repositories?: unknown }).repositories)) {
      return { ...providerError('DISCOVERY_FAILED'), health: 'FAILED' };
    }
    const pageRows = (payload as { repositories: unknown[] }).repositories;
    for (const item of pageRows) {
      const mapped = mapRepository(item);
      if (!mapped) return { ...providerError('DISCOVERY_FAILED'), health: 'FAILED' };
      repositories.push(mapped);
    }
    if (pageRows.length < 100) {
      incomplete = false;
      break;
    }
    incomplete = page === GITHUB_MAX_REPOSITORY_PAGES;
  }
  return {
    ok: true,
    accountLogin,
    accountType,
    appId: input.appId,
    repositories,
    incomplete,
    rateLimit: observed,
  };
}

function mapContent(raw: unknown): GithubContentEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { name?: unknown; path?: unknown; type?: unknown; size?: unknown };
  if (typeof row.name !== 'string' || typeof row.path !== 'string' || typeof row.type !== 'string') return null;
  if (!NAME.test(row.name)) return null;
  const size = typeof row.size === 'number' && Number.isFinite(row.size) ? row.size : 0;
  return { name: row.name, path: row.path, type: row.type, size };
}

export async function readRepositoryContents(input: {
  http?: GithubHttp;
  appId: string;
  privateKey: string;
  installationId: string;
  owner: string;
  repo: string;
  path?: string;
  ref?: string;
  disabled?: boolean;
  nowSeconds?: number;
}): Promise<{ ok: true; entries: GithubContentEntry[]; rateLimit: GithubRateLimit } | GithubFailure> {
  if (input.disabled) return { ...providerError('GITHUB_UNAVAILABLE'), health: 'DEGRADED' };
  if (!NAME.test(input.owner) || !NAME.test(input.repo)) return { ...providerError('GITHUB_NOT_FOUND'), health: 'FAILED' };
  const path = input.path ?? '';
  const depth = path.split('/').filter(Boolean).length;
  if (depth > GITHUB_CONTENT_LIMITS.maxDepth) return { ...providerError('COLLECTION_LIMIT_EXCEEDED'), health: 'DEGRADED' };
  const token = await installationToken({
    http: input.http ?? githubFetch,
    appId: input.appId,
    privateKey: input.privateKey,
    installationId: input.installationId,
    nowSeconds: input.nowSeconds ?? Math.floor(Date.now() / 1000),
  });
  if (!token.ok) return token;
  const suffix = path.split('/').filter(Boolean).map((part) => encodeURIComponent(part)).join('/');
  const ref = input.ref && REF.test(input.ref) ? `?ref=${encodeURIComponent(input.ref)}` : '';
  const listed = await callGithub({
    http: input.http ?? githubFetch,
    method: 'GET',
    url: `${API}/repos/${input.owner}/${input.repo}/contents/${suffix}${ref}`,
    authorization: token.authorization,
  });
  if ('ok' in listed) return listed;
  if (listed.status !== 200) return statusError(listed.status);
  const rows = Array.isArray(listed.body) ? listed.body : [listed.body];
  const entries: GithubContentEntry[] = [];
  for (const row of rows) {
    const mapped = mapContent(row);
    if (!mapped) return { ...providerError('DISCOVERY_FAILED'), health: 'FAILED' };
    entries.push(mapped);
  }
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (
    entries.length > GITHUB_CONTENT_LIMITS.maxFiles
    || entries.some((entry) => entry.size > GITHUB_CONTENT_LIMITS.maxFileBytes)
    || total > GITHUB_CONTENT_LIMITS.maxTotalBytes
  ) {
    return { ...providerError('COLLECTION_LIMIT_EXCEEDED'), health: 'DEGRADED' };
  }
  return { ok: true, entries, rateLimit: rateLimit(listed.headers) };
}

export type GithubRepositoryMetadata = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  visibility: 'public' | 'private' | 'internal' | 'unknown';
  defaultBranch: string | null;
  archived: boolean;
  disabled: boolean;
  htmlUrl: string;
  language: string | null;
  sizeKb: number | null;
};

export type GithubCommitSummary = {
  sha: string;
  author: string;
  authoredAt: string | null;
  committedAt: string | null;
  message: string;
  htmlUrl: string;
};

export type GithubReadme = {
  available: true;
  name: string;
  bytes: number;
  text: string;
} | {
  available: false;
};

export type GithubReadSession = {
  metadata(owner: string, repo: string): Promise<{ ok: true; repository: GithubRepositoryMetadata } | GithubFailure>;
  readme(owner: string, repo: string, ref: string | null): Promise<{ ok: true; readme: GithubReadme } | GithubFailure>;
  commits(owner: string, repo: string, ref: string): Promise<{ ok: true; commits: GithubCommitSummary[]; measured: boolean } | GithubFailure>;
  contents(owner: string, repo: string, path: string, ref: string | null): Promise<{ ok: true; entries: GithubContentEntry[] } | GithubFailure>;
};

const SHA = /^[0-9a-f]{7,40}$/i;
const LANGUAGE = /^[A-Za-z0-9#+.\- ]{1,40}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function mapEvidenceRepository(raw: unknown): GithubRepositoryMetadata | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const owner = row.owner && typeof row.owner === 'object' ? (row.owner as { login?: unknown }).login : null;
  if (typeof row.id !== 'number' || typeof row.name !== 'string' || typeof row.full_name !== 'string' || typeof owner !== 'string') {
    return null;
  }
  if (!NAME.test(owner) || !NAME.test(row.name) || row.full_name !== `${owner}/${row.name}`) return null;
  const visibility = row.visibility === 'public' || row.visibility === 'private' || row.visibility === 'internal'
    ? row.visibility
    : row.private === true ? 'private' : 'public';
  const branch = typeof row.default_branch === 'string' && REF.test(row.default_branch) ? row.default_branch : null;
  const htmlUrl = typeof row.html_url === 'string' && row.html_url.startsWith('https://github.com/') ? row.html_url : '';
  const language = typeof row.language === 'string' && LANGUAGE.test(row.language) ? row.language : null;
  const sizeKb = typeof row.size === 'number' && Number.isFinite(row.size) && row.size >= 0 ? row.size : null;
  return {
    id: row.id,
    owner,
    name: row.name,
    fullName: row.full_name,
    private: row.private === true,
    visibility,
    defaultBranch: branch,
    archived: row.archived === true,
    disabled: row.disabled === true,
    htmlUrl,
    language,
    sizeKb,
  };
}

function mapReadme(raw: unknown): { ok: true; readme: GithubReadme } | GithubFailure {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...providerError('GITHUB_INVALID_RESPONSE'), health: 'FAILED' };
  }
  const row = raw as { name?: unknown; size?: unknown; content?: unknown; encoding?: unknown };
  const name = typeof row.name === 'string' && NAME.test(row.name) ? row.name : 'README';
  const declared = typeof row.size === 'number' && Number.isFinite(row.size) && row.size >= 0 ? row.size : null;
  if (declared !== null && declared > GITHUB_EVIDENCE_LIMITS.maxReadmeBytes) {
    return { ...providerError('COLLECTION_LIMIT_EXCEEDED'), health: 'DEGRADED' };
  }
  if (row.encoding !== undefined && row.encoding !== 'base64' && row.encoding !== null) {
    return { ...providerError('GITHUB_INVALID_RESPONSE'), health: 'FAILED' };
  }
  const encoded = typeof row.content === 'string' ? row.content.replace(/\n/g, '') : '';
  const buffer = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
  if (buffer.includes(0)) return { ok: true, readme: { available: false } };
  if (buffer.byteLength > GITHUB_EVIDENCE_LIMITS.maxReadmeBytes) {
    return { ...providerError('COLLECTION_LIMIT_EXCEEDED'), health: 'DEGRADED' };
  }
  return {
    ok: true,
    readme: { available: true, name, bytes: declared ?? buffer.byteLength, text: buffer.toString('utf8') },
  };
}

function mapCommits(raw: unknown): { ok: true; commits: GithubCommitSummary[] } | GithubFailure {
  if (!Array.isArray(raw)) return { ...providerError('GITHUB_INVALID_RESPONSE'), health: 'FAILED' };
  const commits: GithubCommitSummary[] = [];
  for (const item of raw.slice(0, GITHUB_EVIDENCE_LIMITS.maxCommits)) {
    if (!item || typeof item !== 'object') return { ...providerError('GITHUB_INVALID_RESPONSE'), health: 'FAILED' };
    const row = item as {
      sha?: unknown;
      html_url?: unknown;
      author?: { login?: unknown } | null;
      commit?: { message?: unknown; author?: { name?: unknown; date?: unknown }; committer?: { date?: unknown } };
    };
    if (typeof row.sha !== 'string' || !SHA.test(row.sha)) return { ...providerError('GITHUB_INVALID_RESPONSE'), health: 'FAILED' };
    const login = typeof row.author?.login === 'string' && NAME.test(row.author.login) ? row.author.login : '';
    const name = typeof row.commit?.author?.name === 'string' ? row.commit.author.name : '';
    const author = login || (name && !name.includes('@') && name.length <= 80 ? name : 'unavailable');
    const message = typeof row.commit?.message === 'string' ? row.commit.message.replace(/\0/g, '') : '';
    const htmlUrl = typeof row.html_url === 'string' && row.html_url.startsWith('https://github.com/') ? row.html_url : '';
    commits.push({
      sha: row.sha,
      author,
      authoredAt: typeof row.commit?.author?.date === 'string' && ISO_TIME.test(row.commit.author.date) ? row.commit.author.date : null,
      committedAt: typeof row.commit?.committer?.date === 'string' && ISO_TIME.test(row.commit.committer.date) ? row.commit.committer.date : null,
      message: message.slice(0, GITHUB_EVIDENCE_LIMITS.maxCommitMessageLength),
      htmlUrl,
    });
  }
  return { ok: true, commits };
}

export async function openGithubRead(input: {
  http?: GithubHttp;
  appId: string;
  privateKey: string;
  installationId: string;
  nowSeconds?: number;
}): Promise<{ ok: true; read: GithubReadSession } | GithubFailure> {
  if (!/^\d{1,12}$/.test(input.installationId) || !/^\d{1,12}$/.test(input.appId)) {
    return { ...providerError('GITHUB_NOT_CONFIGURED'), health: 'FAILED' };
  }
  const http = input.http ?? githubFetch;
  const token = await installationToken({
    http,
    appId: input.appId,
    privateKey: input.privateKey,
    installationId: input.installationId,
    nowSeconds: input.nowSeconds ?? Math.floor(Date.now() / 1000),
  });
  if (!token.ok) return token;
  const authorization = token.authorization;

  async function get(url: string): Promise<GithubHttpResponse | GithubFailure> {
    return callGithub({ http, method: 'GET', url, authorization });
  }

  return {
    ok: true,
    read: {
      async metadata(owner, repo) {
        if (!NAME.test(owner) || !NAME.test(repo)) return { ...providerError('GITHUB_NOT_FOUND'), health: 'FAILED' };
        const response = await get(`${API}/repos/${owner}/${repo}`);
        if ('ok' in response) return response;
        if (response.status !== 200) return statusError(response.status);
        const repository = mapEvidenceRepository(response.body);
        if (!repository) return { ...providerError('GITHUB_INVALID_RESPONSE'), health: 'FAILED' };
        return { ok: true, repository };
      },
      async readme(owner, repo, ref) {
        if (!NAME.test(owner) || !NAME.test(repo)) return { ...providerError('GITHUB_NOT_FOUND'), health: 'FAILED' };
        const suffix = ref && REF.test(ref) ? `?ref=${encodeURIComponent(ref)}` : '';
        const response = await get(`${API}/repos/${owner}/${repo}/readme${suffix}`);
        if ('ok' in response) return response;
        if (response.status === 404) return { ok: true, readme: { available: false } };
        if (response.status !== 200) return statusError(response.status);
        return mapReadme(response.body);
      },
      async commits(owner, repo, ref) {
        if (!NAME.test(owner) || !NAME.test(repo) || !REF.test(ref)) return { ...providerError('GITHUB_NOT_FOUND'), health: 'FAILED' };
        const response = await get(`${API}/repos/${owner}/${repo}/commits?per_page=20&sha=${encodeURIComponent(ref)}`);
        if ('ok' in response) return response;
        if (response.status === 404 || response.status === 409) return { ok: true, commits: [], measured: false };
        if (response.status !== 200) return statusError(response.status);
        const mapped = mapCommits(response.body);
        if (!mapped.ok) return mapped;
        return { ok: true, commits: mapped.commits, measured: true };
      },
      async contents(owner, repo, path, ref) {
        if (!NAME.test(owner) || !NAME.test(repo)) return { ...providerError('GITHUB_NOT_FOUND'), health: 'FAILED' };
        const depth = path.split('/').filter(Boolean).length;
        if (depth > GITHUB_EVIDENCE_LIMITS.maxDepth) return { ...providerError('COLLECTION_LIMIT_EXCEEDED'), health: 'DEGRADED' };
        const suffix = path.split('/').filter(Boolean).map((part) => encodeURIComponent(part)).join('/');
        const query = ref && REF.test(ref) ? `?ref=${encodeURIComponent(ref)}` : '';
        const response = await get(`${API}/repos/${owner}/${repo}/contents/${suffix}${query}`);
        if ('ok' in response) return response;
        if (response.status !== 200) return statusError(response.status);
        if (!Array.isArray(response.body)) return { ...providerError('GITHUB_INVALID_RESPONSE'), health: 'FAILED' };
        const entries: GithubContentEntry[] = [];
        for (const row of response.body) {
          const mapped = mapContent(row);
          if (!mapped) return { ...providerError('GITHUB_INVALID_RESPONSE'), health: 'FAILED' };
          entries.push(mapped);
        }
        return { ok: true, entries };
      },
    },
  };
}
