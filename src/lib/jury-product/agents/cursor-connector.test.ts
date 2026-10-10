/**
 * Cursor connector tests. They do not start the real cursor-agent.
 * Run: node --import tsx --test src/lib/jury-product/agents/cursor-connector.test.ts
 */
import assert from 'node:assert/strict';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { removeMockAisleWorkspace, withMockAisleLock } from '../mock-aisle-lock';
import { buildProductCursorInstruction } from '../product-execution';
import type { CursorConnectorRequest, CursorProcess, CursorSpawn } from './cursor-connector';
import { resolveCursorAgentExecutable, runCursorConnector } from './cursor-connector';

const ROOT = 'data/jury-product/workspaces/mock-aisle';
const ABSOLUTE = path.resolve(process.cwd(), ROOT);
const COPY = path.join(ABSOLUTE, 'workspace', 'mock-aisle', 'user-facing-copy.ts');
const FIXTURE_DIR = path.join(os.tmpdir(), 'jury-cursor-agent-fixture');
const FIXTURE_CMD = path.join(FIXTURE_DIR, 'cursor-agent.cmd');
const FIXTURE_NODE = path.join(FIXTURE_DIR, 'node.exe');
const FIXTURE_INDEX = path.join(FIXTURE_DIR, 'index.js');

function request(overrides: Partial<CursorConnectorRequest> = {}): CursorConnectorRequest {
  return {
    executionId: 'phase79-cursor',
    workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
    workspaceRoot: ROOT,
    instruction: 'adjust the user-facing copy',
    timeoutMs: 120_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

test('cursor stays unavailable until the feature flag is set', async () => {
  const previous = process.env.JURY_CURSOR_AGENT_ENABLED;
  delete process.env.JURY_CURSOR_AGENT_ENABLED;
  const spawn = recordingSpawn(() => ({ exit: 0 }));
  try {
    const result = await runCursorConnector(request(), spawn.spawn);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorCode, 'AGENT_NOT_AVAILABLE');
    assert.equal(spawn.calls.length, 0);
  } finally {
    restoreFlag(previous);
  }
});

test('the connector refuses workspaces outside mock-aisle', async () => {
  await withFlag(async () => {
    const cases: Partial<CursorConnectorRequest>[] = [
      { workspaceRef: { type: 'PROJECT', ref: 'jury-product' } },
      { workspaceRef: { type: 'PROJECT', ref: 'C:\\production\\workspace' } },
      { workspaceRoot: 'C:\\dev\\AIsle\\data\\jury-product\\workspaces\\mock-aisle' },
      { workspaceRoot: 'data/jury-product/workspaces/mock-aisle/../mock-aisle' },
      { workspaceRef: { type: 'PROJECT', ref: 're-review-fixture' }, workspaceRoot: 'data/jury-product/workspaces/re-review-fixture' },
      { workspaceRoot: 'data/production/workspace' },
    ];
    for (const item of cases) {
      const spawn = recordingSpawn(() => ({ exit: 0 }));
      const result = await runCursorConnector(request(item), spawn.spawn);
      assert.equal(result.ok, false, JSON.stringify(item));
      if (!result.ok) assert.equal(result.errorCode, 'WORKSPACE_EXECUTION_FAILED');
      assert.equal(spawn.calls.length, 0);
    }
  });
});

test('a symlinked workspace root is refused before spawn', async () => {
  await withMockAisleLock(async () => {
  const target = await import('node:fs/promises').then((fs) => fs.mkdtemp(path.join(os.tmpdir(), 'cursor-target-')));
  await removeMockAisleWorkspace();
  await mkdir(path.dirname(ABSOLUTE), { recursive: true });
  await symlink(target, ABSOLUTE, 'junction');
  try {
    await withFlag(async () => {
      const spawn = recordingSpawn(() => ({ exit: 0 }));
      const result = await runCursorConnector(request(), spawn.spawn);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.errorCode, 'WORKSPACE_EXECUTION_FAILED');
      assert.equal(spawn.calls.length, 0);
    });
  } finally {
    await removeMockAisleWorkspace();
    await rm(target, { recursive: true, force: true });
  }
  });
});

test('an allowlisted workspace without git does not start the process', async () => {
  await withMockAisleLock(() => withFlag(async () => {
    await removeMockAisleWorkspace();
    await mkdir(ABSOLUTE, { recursive: true });
    const spawn = recordingSpawn(() => ({ exit: 0 }));
    const result = await runCursorConnector(request(), spawn.spawn);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorCode, 'WORKSPACE_EXECUTION_FAILED');
    assert.equal(spawn.calls.length, 0);
  }));
});

test('a missing executable is unavailable and a non-zero exit fails the run', async () => {
  await withCleanMockAisle(() => withFlag(async () => {
    await prepareGit();
    const missing = recordingSpawn(() => ({ error: true }));
    const unavailable = await runCursorConnector(request(), missing.spawn);
    assert.equal(unavailable.ok, false);
    if (!unavailable.ok) assert.equal(unavailable.errorCode, 'AGENT_NOT_AVAILABLE');

    const failed = recordingSpawn(() => ({ exit: 1 }));
    const result = await runCursorConnector(request(), failed.spawn);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorCode, 'AGENT_EXECUTION_FAILED');
  }));
});

test('a zero exit reports git paths only and does not treat the process as a passed test', async () => {
  await withMockAisleLock(() => withFlag(async () => {
    await prepareGit();
    try {
      const spawn = recordingSpawn(() => ({
        exit: 0,
        stdout: 'stdout-only.ts\n',
        write: COPY,
      }));
      const previousDatabase = process.env.DATABASE_URL;
      const previousKey = process.env.CURSOR_API_KEY;
      process.env.DATABASE_URL = 'postgres://secret@db.example/app';
      delete process.env.CURSOR_API_KEY;
      try {
        const result = await runCursorConnector(request(), spawn.spawn);
        assert.equal(result.ok, true);
        if (result.ok) {
          assert.deepEqual(result.changedFiles, ['workspace/mock-aisle/user-facing-copy.ts']);
          assert.equal(result.changedFiles.includes('stdout-only.ts'), false);
          assert.deepEqual(result.testsRun, []);
          assert.equal(result.testsPassed, null);
        }
        assert.equal(spawn.calls.length, 1);
        const call = spawn.calls[0];
        assert.equal(call?.command, FIXTURE_NODE);
        assert.deepEqual(call?.args, [FIXTURE_INDEX, '--print', '--output-format', 'text', '--workspace', ABSOLUTE, '--trust']);
        assert.equal(call?.args.filter((arg) => arg === '--trust').length, 1);
        assert.equal(call?.args.includes('--force'), false);
        assert.equal(call?.args.includes('--yolo'), false);
        assert.equal(call?.args.includes('-f'), false);
        assert.equal(call?.options.shell, false);
        assert.equal(call?.options.cwd, ABSOLUTE);
        assert.deepEqual(Object.keys(call?.options.env ?? {}).sort(), ['NODE_ENV', 'PATH']);
        assert.equal(Object.hasOwn(call?.options.env ?? {}, 'DATABASE_URL'), false);
        assert.equal(call?.stdin, 'adjust the user-facing copy');
        assert.equal(call?.args.includes('adjust the user-facing copy'), false);
      } finally {
        if (previousDatabase === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousDatabase;
        if (previousKey === undefined) delete process.env.CURSOR_API_KEY;
        else process.env.CURSOR_API_KEY = previousKey;
      }
    } finally {
      await removeMockAisleWorkspace();
    }
  }));
});

test('timeout and abort stay EXECUTION_TIMEOUT after a non-zero close', async () => {
  await withCleanMockAisle(() => withFlag(async () => {
    await prepareGit();
    const timed = recordingSpawn(() => ({ hang: true, exitOnKill: 1 }));
    const timeout = await runCursorConnector(request({ timeoutMs: 30 }), timed.spawn);
    assert.equal(timeout.ok, false);
    if (!timeout.ok) assert.equal(timeout.errorCode, 'EXECUTION_TIMEOUT');

    const controller = new AbortController();
    const aborted = recordingSpawn(() => ({ hang: true, exitOnKill: 1, onStart: () => controller.abort() }));
    const result = await runCursorConnector(request({ signal: controller.signal }), aborted.spawn);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorCode, 'EXECUTION_TIMEOUT');
  }));
});

test('a secret instruction does not start the process', async () => {
  await withFlag(async () => {
    const spawn = recordingSpawn(() => ({ exit: 0 }));
    const result = await runCursorConnector(request({ instruction: 'password=hidden' }), spawn.spawn);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorCode, 'WORKSPACE_EXECUTION_FAILED');
    assert.equal(spawn.calls.length, 0);
  });
});

test('an authentication failure is an execution failure', async () => {
  await withCleanMockAisle(() => withFlag(async () => {
    await prepareGit();
    const spawn = recordingSpawn(() => ({ exit: 1, stderr: 'Error: Authentication required. Please run agent login first, or set CURSOR_API_KEY.' }));
    const result = await runCursorConnector(request(), spawn.spawn);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, 'AGENT_EXECUTION_FAILED');
      assert.equal(result.message, 'cursor agent authentication required');
    }
    const leaked = recordingSpawn(() => ({ exit: 1, stderr: 'Authentication required password=hidden' }));
    const hidden = await runCursorConnector(request(), leaked.spawn);
    assert.equal(hidden.ok, false);
    if (!hidden.ok) {
      assert.equal(hidden.errorCode, 'AGENT_EXECUTION_FAILED');
      assert.equal(hidden.message, 'cursor agent authentication required');
      assert.equal(hidden.message.includes('password'), false);
    }
  }));
});

test('CURSOR_API_KEY is forwarded only when it is already set', async () => {
  await withCleanMockAisle(() => withFlag(async () => {
    const previousKey = process.env.CURSOR_API_KEY;
    const previousDatabase = process.env.DATABASE_URL;
    process.env.CURSOR_API_KEY = 'cursor-test-key';
    process.env.DATABASE_URL = 'postgres://secret@db.example/app';
    try {
      await prepareGit();
      const spawn = recordingSpawn(() => ({ exit: 1 }));
      await runCursorConnector(request(), spawn.spawn);
      const env = spawn.calls[0]?.options.env;
      assert.deepEqual(Object.keys(env ?? {}).sort(), ['CURSOR_API_KEY', 'NODE_ENV', 'PATH']);
      assert.equal(env?.CURSOR_API_KEY, 'cursor-test-key');
      assert.equal(Object.hasOwn(env ?? {}, 'DATABASE_URL'), false);
    } finally {
      if (previousKey === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = previousKey;
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
    }
  }));
});

test('the executable resolver uses the installed launcher and rejects other programs', async () => {
  const root = await import('node:fs/promises').then((fs) => fs.mkdtemp(path.join(os.tmpdir(), 'cursor-resolve-')));
  const newest = path.join(root, 'Cursor', 'User', 'globalStorage', 'anysphere.cursor-agent-worker', 'agent-cli', '.local', 'share', 'cursor-agent', 'versions', '2026.10.01-e373342');
  const older = path.join(root, 'Cursor', 'User', 'globalStorage', 'anysphere.cursor-agent-worker', 'agent-cli', '.local', 'share', 'cursor-agent', 'versions', '2026.08.01-aaaaaaa');
  const pathDir = path.join(root, 'path-bin');
  const overrideDir = path.join(root, 'override');
  try {
    await writeLauncher(older);
    await writeLauncher(newest);
    await mkdir(pathDir, { recursive: true });
    await writeFile(path.join(pathDir, 'cursor-agent.exe'), '', 'utf8');
    await writeLauncher(overrideDir);
    await writeFile(path.join(root, 'cmd.exe'), '', 'utf8');
    const installed = await resolveCursorAgentExecutable({ APPDATA: root, PATH: pathDir, HOME: root, USERPROFILE: root });
    assert.equal(installed?.command, path.join(newest, 'node.exe'));
    assert.deepEqual(installed?.prefixArgs, [path.join(newest, 'index.js')]);
    const fromPath = await resolveCursorAgentExecutable({ APPDATA: path.join(root, 'missing'), PATH: pathDir, HOME: path.join(root, 'missing-home'), USERPROFILE: path.join(root, 'missing-home') });
    assert.equal(fromPath?.command, path.join(pathDir, 'cursor-agent.exe'));
    assert.deepEqual(fromPath?.prefixArgs, []);
    const override = await resolveCursorAgentExecutable({ CURSOR_AGENT_EXECUTABLE: path.join(overrideDir, 'cursor-agent.cmd'), APPDATA: root, PATH: pathDir });
    assert.equal(override?.command, path.join(overrideDir, 'node.exe'));
    assert.equal(await resolveCursorAgentExecutable({ CURSOR_AGENT_EXECUTABLE: path.join(root, 'cmd.exe') }), null);
    assert.equal(await resolveCursorAgentExecutable({ CURSOR_AGENT_EXECUTABLE: path.join(root, '..', 'cursor-agent.cmd') }), null);
    await withFlag(async () => {
      const missing = recordingSpawn(() => ({ exit: 0 }));
      const unavailable = await runCursorConnector(request(), missing.spawn, { JURY_CURSOR_AGENT_ENABLED: '1', APPDATA: path.join(root, 'empty'), PATH: path.join(root, 'empty-path'), HOME: path.join(root, 'empty-home'), USERPROFILE: path.join(root, 'empty-home'), NODE_ENV: 'test' });
      assert.equal(unavailable.ok, false);
      if (!unavailable.ok) assert.equal(unavailable.errorCode, 'AGENT_NOT_AVAILABLE');
      assert.equal(missing.calls.length, 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cursor instruction keeps the task text and drops identifiers', () => {
  const text = buildProductCursorInstruction({
    diagnosis: '문구를 줄인다',
    acceptanceCriteria: ['측정된 범위만 말한다'],
    evidenceId: 'secret-evidence-id',
    reviewResultId: 'secret-review-id',
    humanDecisionId: 'secret-human-id',
    credentialRef: 'stored-secret',
  });
  assert.equal(text.includes('문구를 줄인다'), true);
  assert.equal(text.includes('측정된 범위만 말한다'), true);
  assert.equal(text.includes('Evidence 값을 변경하지 않는다'), true);
  assert.equal(text.includes('secret-evidence-id'), false);
  assert.equal(text.includes('secret-review-id'), false);
  assert.equal(text.includes('secret-human-id'), false);
  assert.equal(text.includes('stored-secret'), false);
});

function recordingSpawn(plan: () => { exit?: number; error?: boolean; stdout?: string; stderr?: string; write?: string; hang?: boolean; exitOnKill?: number; onStart?: () => void }) {
  const calls: Array<{ command: string; args: readonly string[]; options: { shell: false; cwd: string; env: { PATH: string; NODE_ENV: string; CURSOR_API_KEY?: string } }; stdin: string }> = [];
  const spawn: CursorSpawn = (command, args, options) => {
    const behavior = plan();
    const call = { command, args, options, stdin: '' };
    calls.push(call);
    let closeListener: ((status: number | null) => void) | null = null;
    let errorListener: (() => void) | null = null;
    const stdoutListeners: Array<(chunk: Buffer) => void> = [];
    const stderrListeners: Array<(chunk: Buffer) => void> = [];
    const processHandle: CursorProcess = {
      stdin: {
        end(value: string) {
          call.stdin = value;
          behavior.onStart?.();
          if (behavior.write) writeFile(behavior.write, 'export const userFacingCopy = "after";\n', 'utf8').then(() => finish());
          else finish();
        },
      },
      stdout: { on(_event, listener) { stdoutListeners.push(listener); } },
      stderr: { on(_event, listener) { stderrListeners.push(listener); } },
      once(event, listener) {
        if (event === 'error') errorListener = listener as () => void;
        if (event === 'close') closeListener = listener as (status: number | null) => void;
      },
      kill() {
        closeListener?.(behavior.exitOnKill ?? 1);
      },
    };
    function finish() {
      if (behavior.stdout) for (const listener of stdoutListeners) listener(Buffer.from(behavior.stdout));
      if (behavior.stderr) for (const listener of stderrListeners) listener(Buffer.from(behavior.stderr));
      if (behavior.error) errorListener?.();
      else if (!behavior.hang) closeListener?.(behavior.exit ?? 0);
    }
    return processHandle;
  };
  return { spawn, calls };
}

let workspaceLock: Promise<void> = Promise.resolve();

async function withFlag(run: () => Promise<void>): Promise<void> {
  const previousLock = workspaceLock;
  let release!: () => void;
  workspaceLock = new Promise((resolve) => { release = resolve; });
  await previousLock;
  await ensureFixture();
  const previous = process.env.JURY_CURSOR_AGENT_ENABLED;
  const previousExecutable = process.env.CURSOR_AGENT_EXECUTABLE;
  process.env.JURY_CURSOR_AGENT_ENABLED = '1';
  process.env.CURSOR_AGENT_EXECUTABLE = FIXTURE_CMD;
  try {
    await run();
  } finally {
    restoreFlag(previous);
    if (previousExecutable === undefined) delete process.env.CURSOR_AGENT_EXECUTABLE;
    else process.env.CURSOR_AGENT_EXECUTABLE = previousExecutable;
    release();
  }
}

async function ensureFixture(): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(FIXTURE_CMD, '', 'utf8');
  await writeFile(FIXTURE_NODE, '', 'utf8');
  await writeFile(FIXTURE_INDEX, '', 'utf8');
}

async function writeLauncher(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'cursor-agent.cmd'), '', 'utf8');
  await writeFile(path.join(directory, 'node.exe'), '', 'utf8');
  await writeFile(path.join(directory, 'index.js'), '', 'utf8');
}

function restoreFlag(previous: string | undefined): void {
  if (previous === undefined) delete process.env.JURY_CURSOR_AGENT_ENABLED;
  else process.env.JURY_CURSOR_AGENT_ENABLED = previous;
}

/** Holds the shared mock-aisle lock and removes the workspace this test prepared, also on failure. */
async function withCleanMockAisle<T>(fn: () => Promise<T>): Promise<T> {
  return withMockAisleLock(async () => {
    try {
      return await fn();
    } finally {
      await removeMockAisleWorkspace();
    }
  });
}

async function prepareGit(): Promise<void> {
  await removeMockAisleWorkspace();
  await mkdir(path.dirname(COPY), { recursive: true });
  await writeFile(COPY, 'export const userFacingCopy = "before";\n', 'utf8');
  git(['init']);
  git(['add', 'workspace/mock-aisle/user-facing-copy.ts']);
  git(['-c', 'user.email=jury-fixture@example.com', '-c', 'user.name=jury-fixture', 'commit', '-m', 'baseline']);
}

function git(args: string[]): void {
  const result = spawnSync('git', args, { cwd: ABSOLUTE, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'git failed');
}
