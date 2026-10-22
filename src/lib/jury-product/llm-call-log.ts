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

/**
 * RM-03 (I-003, IP-04): optional per-call timeout and total budget around a ReviewBoardLlm.
 * Applied OUTSIDE src/lib/ai-review-board; prompts and judging are unchanged. A timed-out call
 * rejects with LLM_TIMEOUT / LLM_BUDGET_EXCEEDED so the attempt is stored as FAILED instead of
 * the platform killing the request without a record. Limits are inactive (null) until D-06 fixes values.
 */
export type LlmBudget = { perCallMs: number | null; totalMs: number | null };

export function readLlmBudget(env: Record<string, string | undefined>): LlmBudget {
  const num = (raw: string | undefined): number | null => {
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1000 && n <= 900_000 ? Math.floor(n) : null;
  };
  return { perCallMs: num(env.JURY_LLM_CALL_TIMEOUT_MS), totalMs: num(env.JURY_LLM_TOTAL_BUDGET_MS) };
}

export function withLlmBudget(
  llm: ReviewBoardLlm,
  budget: LlmBudget,
  clock: () => number = () => Date.now(),
  timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout },
): ReviewBoardLlm {
  if (budget.perCallMs === null && budget.totalMs === null) return llm;
  const startedAt = clock();
  return new Proxy(llm, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      return (...args: unknown[]) => {
        const remaining = budget.totalMs === null ? null : budget.totalMs - (clock() - startedAt);
        if (remaining !== null && remaining <= 0) return Promise.reject(new Error('LLM_BUDGET_EXCEEDED'));
        const limits = [budget.perCallMs, remaining].filter((v): v is number => v !== null);
        const limit = Math.min(...limits);
        const code = remaining !== null && (budget.perCallMs === null || remaining < budget.perCallMs) ? 'LLM_BUDGET_EXCEEDED' : 'LLM_TIMEOUT';
        let handle: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          handle = timers.set(() => reject(new Error(code)), limit);
        });
        const call = Promise.resolve((value as (...a: unknown[]) => unknown).apply(target, args));
        return Promise.race([call, timeout]).finally(() => {
          if (handle !== undefined) timers.clear(handle);
        });
      };
    },
  });
}
