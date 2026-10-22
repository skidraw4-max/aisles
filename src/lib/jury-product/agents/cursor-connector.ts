/**
 * The only place that starts the Cursor Agent CLI.
 * It does not approve a change or read the product database.
 */
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { containsSecret } from '../agent-execution';
import type { WorkspaceRef } from '../agent-handoff';
import { resolveAllowedWorkspace } from '../agent-workspace';
import { inspectAllowlistedWorkspace } from '../change-gate-workspace';
import type { AgentAdapterResult } from './agent-adapter';

const ENABLED = '1';
const OUTPUT_LIMIT = 16_000;
const LAUNCHER_NAMES = new Set(['cursor-agent', 'cursor-agent.cmd', 'cursor-agent.exe', 'cursor-agent.ps1']);
const VERSION_DIRECTORY = /^\d{4}\.\d{1,2}\.\d{1,2}(?:-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/;

export type CursorConnectorRequest = {
  executionId: string;
  workspaceRef: WorkspaceRef;
  workspaceRoot: string;
  instruction: string;
  timeoutMs: number;
  signal: AbortSignal;
};

export type CursorProcessEnv = {
  PATH: string;
  NODE_ENV: string;
  CURSOR_API_KEY?: string;
};

export type CursorExecutable = {
  command: string;
  prefixArgs: readonly string[];
};

export type CursorProcess = {
  stdin: { end(value: string): void } | null;
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): void } | null;
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): void } | null;
  once(event: 'error', listener: () => void): void;
  once(event: 'close', listener: (status: number | null) => void): void;
  kill(): void;
};

export type CursorSpawn = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    shell: false;
    env: CursorProcessEnv;
    stdio: ['pipe', 'pipe', 'pipe'];
  },
) => CursorProcess;

export async function runCursorConnector(
  input: CursorConnectorRequest,
  spawnProcess?: CursorSpawn,
  sourceEnv?: NodeJS.ProcessEnv,
): Promise<AgentAdapterResult> {
  const source = sourceEnv ?? process.env;
  const target = cursorWorkspace(input.workspaceRef, input.workspaceRoot);
  if (!target.ok) return target.result;
  if (containsSecret(input.instruction)) {
    return { ok: false, errorCode: 'WORKSPACE_EXECUTION_FAILED', message: 'instruction refused' };
  }
  if (source.JURY_CURSOR_AGENT_ENABLED !== ENABLED) {
    return { ok: false, errorCode: 'AGENT_NOT_AVAILABLE', message: 'cursor agent is disabled' };
  }
  if (await linkedWorkspace(target.directory)) return targetRefused();
  if (input.signal.aborted || !Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    return { ok: false, errorCode: 'EXECUTION_TIMEOUT', message: 'run cancelled' };
  }
  const executable = await resolveCursorAgentExecutable(source);
  if (!executable) return { ok: false, errorCode: 'AGENT_NOT_AVAILABLE', message: 'cursor agent is unavailable' };
  if (!(await gitWorkspace(target.directory))) return targetRefused();
  const spawnImpl = spawnProcess ?? ((await import('node:child_process')).spawn as unknown as CursorSpawn);
  const child = spawnImpl(executable.command, [
    ...executable.prefixArgs,
    '--print',
    '--output-format',
    'text',
    '--workspace',
    target.directory,
    '--trust',
  ], {
    cwd: target.directory,
    shell: false,
    env: cursorProcessEnv(source),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stop: 'timeout' | 'abort' | null = null;
  const stopProcess = (reason: 'timeout' | 'abort') => {
    if (stop) return;
    stop = reason;
    child.kill();
  };
  const timer = setTimeout(() => stopProcess('timeout'), input.timeoutMs);
  const onAbort = () => stopProcess('abort');
  input.signal.addEventListener('abort', onAbort, { once: true });
  let captured = '';
  const remember = (chunk: Buffer) => {
    captured = (captured + chunk.toString('utf8')).slice(-OUTPUT_LIMIT);
  };
  child.stdout?.on('data', remember);
  child.stderr?.on('data', remember);
  const closed = new Promise<number | null>((resolve) => {
    child.once('error', () => resolve(null));
    child.once('close', (status) => resolve(status));
  });
  child.stdin?.end(input.instruction);
  try {
    const code = await closed;
    if (stop) return { ok: false, errorCode: 'EXECUTION_TIMEOUT', message: 'run cancelled' };
    if (code === null) return { ok: false, errorCode: 'AGENT_NOT_AVAILABLE', message: 'cursor agent is unavailable' };
    if (code !== 0) {
      const authentication = captured.includes('Authentication required');
      return {
        ok: false,
        errorCode: 'AGENT_EXECUTION_FAILED',
        message: authentication ? 'cursor agent authentication required' : 'cursor agent exited',
      };
    }
    const inspected = await inspectAllowlistedWorkspace(input.workspaceRoot);
    if (!inspected.ok) return { ok: false, errorCode: 'WORKSPACE_EXECUTION_FAILED', message: 'workspace is not allowlisted' };
    return {
      ok: true,
      changedFiles: inspected.files.map((file) => file.path).filter((file) => !file.includes('..') && !path.isAbsolute(file)),
      summary: 'cursor agent exited',
      testsRun: [],
      testsPassed: null,
    };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener('abort', onAbort);
  }
}

export async function resolveCursorAgentExecutable(source: NodeJS.ProcessEnv = process.env): Promise<CursorExecutable | null> {
  const override = source.CURSOR_AGENT_EXECUTABLE;
  if (typeof override === 'string' && override.length > 0) return launchable(override);
  for (const root of installRoots(source)) {
    const installed = await newestInstall(root);
    if (installed) return installed;
  }
  return pathExecutable(source.PATH ?? '');
}

function cursorProcessEnv(source: NodeJS.ProcessEnv): CursorProcessEnv {
  const env: CursorProcessEnv = {
    PATH: source.PATH ?? '',
    NODE_ENV: source.NODE_ENV ?? 'development',
  };
  if (typeof source.CURSOR_API_KEY === 'string' && source.CURSOR_API_KEY.length > 0) env.CURSOR_API_KEY = source.CURSOR_API_KEY;
  return env;
}

function installRoots(source: NodeJS.ProcessEnv): string[] {
  const roots: string[] = [];
  if (source.APPDATA) roots.push(path.join(source.APPDATA, 'Cursor', 'User', 'globalStorage', 'anysphere.cursor-agent-worker', 'agent-cli', '.local', 'share', 'cursor-agent'));
  const home = source.USERPROFILE || source.HOME;
  if (home) roots.push(path.join(home, '.local', 'share', 'cursor-agent'));
  return roots;
}

async function newestInstall(root: string): Promise<CursorExecutable | null> {
  const versions = path.join(root, 'versions');
  let names: string[] = [];
  try {
    names = (await readdir(versions)).filter((name) => VERSION_DIRECTORY.test(name));
  } catch {
    return launchable(path.join(root, 'cursor-agent.cmd'));
  }
  names.sort((left, right) => versionRank(right) - versionRank(left) || right.localeCompare(left));
  for (const name of names) {
    const found = await launchable(path.join(versions, name, 'cursor-agent.cmd'));
    if (found) return found;
  }
  return null;
}

function versionRank(name: string): number {
  const [year, month, day] = name.split('-')[0]?.split('.') ?? [];
  if (!year || !month || !day) return -1;
  return Number(year) * 10_000 + Number(month) * 100 + Number(day);
}

async function pathExecutable(pathValue: string): Promise<CursorExecutable | null> {
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const name of LAUNCHER_NAMES) {
      const found = await launchable(path.join(directory, name));
      if (found) return found;
    }
  }
  return null;
}

async function launchable(candidate: string): Promise<CursorExecutable | null> {
  if (!path.isAbsolute(candidate) || candidate.includes('..')) return null;
  const base = path.basename(candidate).toLowerCase();
  if (!LAUNCHER_NAMES.has(base)) return null;
  if (!(await regularFile(candidate))) return null;
  if (base.endsWith('.cmd') || base.endsWith('.ps1')) {
    const directory = path.dirname(candidate);
    const nodePath = path.join(directory, 'node.exe');
    const indexPath = path.join(directory, 'index.js');
    if (!(await regularFile(nodePath)) || !(await regularFile(indexPath))) return null;
    return { command: nodePath, prefixArgs: [indexPath] };
  }
  return { command: candidate, prefixArgs: [] };
}

async function regularFile(file: string): Promise<boolean> {
  try {
    const stat = await lstat(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function cursorWorkspace(
  workspaceRef: WorkspaceRef,
  workspaceRoot: string,
): { ok: true; directory: string } | { ok: false; result: AgentAdapterResult } {
  if (workspaceRef.type !== 'PROJECT' || workspaceRef.ref === 'jury-product' || workspaceRef.ref !== 'mock-aisle') return { ok: false, result: targetRefused() };
  if (workspaceRoot.includes('..') || path.isAbsolute(workspaceRoot)) return { ok: false, result: targetRefused() };
  const allowed = resolveAllowedWorkspace(workspaceRef);
  if (!allowed || workspaceRoot !== allowed) return { ok: false, result: targetRefused() };
  const parent = path.resolve(process.cwd(), 'data', 'jury-product', 'workspaces');
  const directory = path.resolve(process.cwd(), workspaceRoot);
  if (directory !== path.resolve(parent, 'mock-aisle') || !directory.startsWith(parent + path.sep)) return { ok: false, result: targetRefused() };
  return { ok: true, directory };
}

function targetRefused(): AgentAdapterResult {
  return { ok: false, errorCode: 'WORKSPACE_EXECUTION_FAILED', message: 'workspace is not allowlisted' };
}

async function linkedWorkspace(directory: string): Promise<boolean> {
  try {
    return (await lstat(directory)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function gitWorkspace(directory: string): Promise<boolean> {
  try {
    const stat = await lstat(path.join(directory, '.git'));
    return !stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile());
  } catch {
    return false;
  }
}
