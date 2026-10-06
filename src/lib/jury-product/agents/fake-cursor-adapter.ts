/**
 * Deterministic stand-in for the Cursor adapter.
 * It does not spawn a process or write the product source.
 */
import type { AgentAdapter, AgentAdapterInput, AgentAdapterResult } from './agent-adapter';

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
      const result: AgentAdapterResult = {
        ok: true,
        changedFiles: ['workspace/mock-aisle/user-facing-copy.ts'],
        summary: '사용자 노출 문구를 작업 제약 안에서 조정하는 변경을 준비했다.',
        testsRun: [],
        testsPassed: null,
      };
      return result;
    },
  };
}
