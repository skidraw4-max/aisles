/**
 * RM-01 / D-14: per-LLM-call metadata capture for the frozen review board.
 * Wraps a ReviewBoardLlm from OUTSIDE src/lib/ai-review-board: every method is forwarded
 * unchanged (same arguments, same return value, same thrown error). Only metadata is kept:
 * operation, memberId (when the first argument is a member id string), status, error class,
 * latency, start time. Prompts, responses, evidence text and keys are never recorded.
 */
import type { ReviewBoardLlm } from '../ai-review-board/llm';

export type JuryResultSourceValue = 'REAL_MODEL' | 'MOCK' | 'FIXTURE' | 'UNKNOWN_LEGACY' | 'VERIFIED_REAL';
export const JURY_RESULT_SOURCES: readonly JuryResultSourceValue[] = [
  'REAL_MODEL',
  'MOCK',
  'FIXTURE',
  'UNKNOWN_LEGACY',
  'VERIFIED_REAL',
];

export type LlmCallRecord = {
  seq: number;
  provider: string;
  model: string | null;
  operation: string;
  memberId: string | null;
  status: 'OK' | 'ERROR';
  errorCode: string | null;
  latencyMs: number;
  startedAt: string;
};

export type LlmCallRecorder = {
  readonly calls: readonly LlmCallRecord[];
  push(record: Omit<LlmCallRecord, 'seq'>): void;
};

export function createLlmCallRecorder(limit = 500): LlmCallRecorder {
  const calls: LlmCallRecord[] = [];
  return {
    calls,
    push(record) {
      if (calls.length >= limit) return;
      calls.push({ ...record, seq: calls.length });
    },
  };
}

const MEMBER_ID = /^[a-z][a-z0-9_-]{0,39}$/i;

/** Error class only: a short code, never the message (messages can echo prompts or keys). */
export function llmErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isInteger(status)) return `HTTP_${status}`;
    const name = (error as { name?: unknown }).name;
    if (name === 'AbortError' || name === 'TimeoutError') return 'TIMEOUT';
  }
  if (error instanceof Error && /^[A-Z0-9_]{3,40}$/.test(error.message)) return error.message;
  return 'LLM_ERROR';
}

export function instrumentReviewBoardLlm(
  llm: ReviewBoardLlm,
  meta: { provider: string; model?: string | null },
  recorder: LlmCallRecorder,
  clock: () => number = () => Date.now(),
): ReviewBoardLlm {
  return new Proxy(llm, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      return async (...args: unknown[]) => {
        const start = clock();
        const memberId = typeof args[0] === 'string' && MEMBER_ID.test(args[0]) ? args[0] : null;
        const base = {
          provider: meta.provider,
          model: meta.model ?? null,
          operation: prop,
          memberId,
          startedAt: new Date(start).toISOString(),
        };
        try {
          const out = await (value as (...a: unknown[]) => unknown).apply(target, args);
          recorder.push({ ...base, status: 'OK', errorCode: null, latencyMs: Math.max(0, clock() - start) });
          return out;
        } catch (error) {
          recorder.push({ ...base, status: 'ERROR', errorCode: llmErrorCode(error), latencyMs: Math.max(0, clock() - start) });
          throw error;
        }
      };
    },
  });
}
