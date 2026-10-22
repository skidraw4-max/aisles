/**
 * Deterministic stand-in for the Cursor adapter.
 * It does not spawn a process or write the product source.
 * A product run with the mock-aisle root may edit only that fixture file.
 */
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentAdapter, AgentAdapterInput, AgentAdapterResult } from './agent-adapter';

const MOCK_ROOT = 'data/jury-product/workspaces/mock-aisle';
const FIXTURE = 'workspace/mock-aisle/user-facing-copy.ts';
const FIXTURE_BODY = 'export const userFacingCopy = "측정된 Evidence가 직접 지지하는 범위의 문구만 사용합니다.";\n';

export type FakeCursorMode = 'success' | 'fail' | 'timeout' | 'hang' | 'unsafe-path' | 'secret';

export function fakeCursorAdapter(mode: FakeCursorMode = 'success'): AgentAdapter & { calls: AgentAdapterInput[] } {
  const calls: AgentAdapterInput[] = [];
  return {
    calls,
    async run(input) {
      calls.push(input);
      if (mode === 'hang') {
        await new Promise<void>((resolve) => {
          if (input.signal.aborted) {
            resolve();
            return;
          }
          input.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { ok: false, errorCode: 'EXECUTION_TIMEOUT', message: 'aborted' };
      }
      if (mode === 'timeout') return { ok: false, errorCode: 'EXECUTION_TIMEOUT', message: 'timed out' };
      if (mode === 'fail') return { ok: false, errorCode: 'AGENT_EXECUTION_FAILED', message: 'adapter failed' };
      if (mode === 'unsafe-path') {
        return {
          ok: true,
          changedFiles: ['../outside.ts'],
          summary: 'rejected by the service',
          testsRun: [],
          testsPassed: null,
        };
      }
      if (mode === 'secret') {
        return {
          ok: true,
          changedFiles: ['workspace/mock-aisle/user-facing-copy.ts'],
          summary: 'credentialRef=should-not-store',
          testsRun: [],
          testsPassed: null,
        };
      }
      return executeFakeCursorLocal(input.workspaceRoot);
    },
  };
}

export async function executeFakeCursorLocal(workspaceRoot: string): Promise<AgentAdapterResult> {
  const fixture = await mockFixtureMode(workspaceRoot);
  if (fixture === 'refuse') return { ok: false, errorCode: 'WORKSPACE_EXECUTION_FAILED', message: 'fixture edit refused' };
  if (fixture === 'edit') {
    const wrote = await editMockFixture(workspaceRoot);
    if (!wrote) return { ok: false, errorCode: 'WORKSPACE_EXECUTION_FAILED', message: 'fixture edit refused' };
  }
  return {
    ok: true,
    changedFiles: [FIXTURE],
    summary: '사용자 노출 문구를 작업 제약 안에서 조정하는 변경을 준비했다.',
    testsRun: [],
    testsPassed: null,
  };
}

async function mockFixtureMode(workspaceRoot: string): Promise<'skip' | 'edit' | 'refuse'> {
  if (!workspaceRoot) return 'skip';
  if (workspaceRoot !== MOCK_ROOT || workspaceRoot.includes('..') || path.isAbsolute(workspaceRoot)) return 'refuse';
  const root = path.resolve(process.cwd(), workspaceRoot);
  const parent = path.resolve(process.cwd(), 'data', 'jury-product', 'workspaces');
  if (root !== path.resolve(parent, 'mock-aisle') || !root.startsWith(parent + path.sep)) return 'refuse';
  try {
    const gitDir = await lstat(path.join(root, '.git'));
    if (gitDir.isSymbolicLink()) return 'refuse';
    return 'edit';
  } catch {
    return 'skip';
  }
}

async function editMockFixture(workspaceRoot: string): Promise<boolean> {
  if (workspaceRoot !== MOCK_ROOT || workspaceRoot.includes('..') || path.isAbsolute(workspaceRoot)) return false;
  const parent = path.resolve(process.cwd(), 'data', 'jury-product', 'workspaces');
  const root = path.resolve(process.cwd(), workspaceRoot);
  if (root !== path.resolve(parent, 'mock-aisle') || !root.startsWith(parent + path.sep)) return false;
  const target = path.resolve(root, FIXTURE);
  if (!target.startsWith(root + path.sep) || path.basename(target) !== 'user-facing-copy.ts') return false;
  if (await isLink(root) || await isLink(path.resolve(root, 'workspace')) || await isLink(path.dirname(target)) || await isLink(target)) {
    return false;
  }
  await mkdir(path.dirname(target), { recursive: true });
  if (await isLink(target)) return false;
  await writeFile(target, FIXTURE_BODY, { encoding: 'utf8', flag: 'w' });
  return true;
}

async function isLink(file: string): Promise<boolean> {
  try {
    return (await lstat(file)).isSymbolicLink();
  } catch {
    return false;
  }
}
