/**
 * Read-only view of the allowlisted mock-aisle workspace.
 * It does not commit, push, reset, or follow a path outside that directory.
 */
import { spawn } from 'node:child_process';
import { access, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceChange } from './change-gate';

const ROOT = 'data/jury-product/workspaces/mock-aisle';
const READ_ONLY_GIT = [
  ['diff', '--name-status', 'HEAD', '--'],
  ['diff', '--numstat', 'HEAD', '--'],
  ['ls-files', '--others', '--exclude-standard'],
] as const;

export async function inspectAllowlistedWorkspace(relativeRoot: string): Promise<
  | { ok: true; files: WorkspaceChange[]; present: string[] }
  | { ok: false; reason: 'WORKSPACE_NOT_ALLOWED' | 'WORKSPACE_ESCAPE' }
> {
  if (relativeRoot !== ROOT) return { ok: false, reason: 'WORKSPACE_NOT_ALLOWED' };
  const absolute = path.resolve(process.cwd(), ROOT);
  const parent = path.resolve(process.cwd(), 'data', 'jury-product', 'workspaces');
  if (!absolute.startsWith(parent + path.sep)) return { ok: false, reason: 'WORKSPACE_ESCAPE' };
  try {
    await access(absolute);
  } catch {
    return { ok: true, files: [], present: [] };
  }
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) return { ok: false, reason: 'WORKSPACE_ESCAPE' };
  const present = await listPresent(absolute, absolute);
  let files: WorkspaceChange[] = [];
  try {
    await access(path.join(absolute, '.git'));
    files = await readGitChanges(absolute);
  } catch {
    files = [];
  }
  return { ok: true, files, present };
}

async function listPresent(root: string, current: string): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    const relative = path.relative(root, absolute).replace(/\\/g, '/');
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    if (entry.isDirectory()) found.push(...(await listPresent(root, absolute)));
    else found.push(relative);
  }
  return found;
}

async function readGitChanges(cwd: string): Promise<WorkspaceChange[]> {
  const nameStatus = await git(cwd, READ_ONLY_GIT[0]);
  const numstat = await git(cwd, READ_ONLY_GIT[1]);
  const untracked = await git(cwd, READ_ONLY_GIT[2]);
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstat.split('\n')) {
    const [add, del, file] = line.split('\t');
    if (!file || file.includes('..')) continue;
    counts.set(file, { additions: Number(add) || 0, deletions: Number(del) || 0 });
  }
  const files: WorkspaceChange[] = [];
  for (const line of nameStatus.split('\n')) {
    const [code, file] = line.split('\t');
    if (!file || file.includes('..') || !code) continue;
    const kind = code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified';
    const count = counts.get(file) ?? { additions: 0, deletions: 0 };
    files.push({ path: file, kind, ...count });
  }
  for (const file of untracked.split('\n')) {
    if (!file || file.includes('..') || files.some((row) => row.path === file)) continue;
    files.push({ path: file, kind: 'added', additions: 0, deletions: 0 });
  }
  return files;
}

function git(cwd: string, args: readonly string[]): Promise<string> {
  const allowed = READ_ONLY_GIT.some((command) => command.join(' ') === args.join(' '));
  if (!allowed) return Promise.resolve('');
  return new Promise((resolve) => {
    const child = spawn('git', [...args], { cwd, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.once('error', () => resolve(''));
    child.once('close', () => resolve(out.trim()));
  });
}
