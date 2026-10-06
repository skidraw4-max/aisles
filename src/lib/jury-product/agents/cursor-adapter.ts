/**
 * Cursor agent boundary.
 * The process starts only when JURY_CURSOR_AGENT_ENABLED=1 and the workspace is allowlisted.
 */
import path from 'node:path';
import { resolveAllowedWorkspace } from '../agent-workspace';
import type { AgentAdapterInput, AgentAdapterResult } from './agent-adapter';

const ENABLED = '1';

export async function runCursorAdapter(input: AgentAdapterInput): Promise<AgentAdapterResult> {
  if (process.env.JURY_CURSOR_AGENT_ENABLED !== ENABLED) {
    return { ok: false, errorCode: 'AGENT_NOT_AVAILABLE', message: 'cursor agent is disabled' };
  }
  const allowed = resolveAllowedWorkspace(input.workspaceRef);
  const root = path.resolve(process.cwd(), 'data', 'jury-product', 'workspaces');
  const target = allowed ? path.resolve(process.cwd(), allowed) : '';
  const staysInside = target.startsWith(root + path.sep) && target === path.resolve(root, 'mock-aisle');
  if (!allowed || allowed !== input.workspaceRoot || !staysInside) {
    return { ok: false, errorCode: 'WORKSPACE_EXECUTION_FAILED', message: 'workspace is not allowlisted' };
  }
  const { spawn } = await import('node:child_process');
  const child = spawn('cursor-agent', ['--workspace', target], {
    cwd: target,
    shell: false,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'development' },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  const piped = child as {
    stdin: { end(value: string): void } | null;
    once(event: 'error', listener: () => void): void;
    once(event: 'close', listener: (status: number | null) => void): void;
    kill(): void;
  };
  piped.stdin?.end(input.instruction);
  const timer = setTimeout(() => piped.kill(), 120_000);
  const code = await new Promise<number | null>((resolve) => {
    piped.once('error', () => resolve(null));
    piped.once('close', (status) => resolve(status));
  });
  clearTimeout(timer);
  if (code === null) return { ok: false, errorCode: 'AGENT_NOT_AVAILABLE', message: 'cursor agent is unavailable' };
  if (code !== 0) return { ok: false, errorCode: 'AGENT_EXECUTION_FAILED', message: 'cursor agent exited' };
  return {
    ok: true,
    changedFiles: [],
    summary: 'cursor agent exited',
    testsRun: [],
    testsPassed: null,
  };
}
