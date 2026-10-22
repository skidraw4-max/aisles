/**
 * Per-LLM-call transport context (D-16 follow-up). Carries an AbortSignal from the Jury timeout
 * wrapper down to the Gemini request, and reports back which model actually answered and whether
 * the model fallback chain issued more than one request. Transport metadata only: prompts,
 * responses, model order and judging are unchanged.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type LlmCallContext = {
  signal?: AbortSignal;
  /** Model ids requested, in order (one entry per HTTP request). */
  attempts: string[];
  /** Model id whose response was used. */
  respondedModel?: string;
};

const storage = new AsyncLocalStorage<LlmCallContext>();

export function currentLlmCallContext(): LlmCallContext | undefined {
  return storage.getStore();
}

/** Run fn inside the current call context, or a fresh one when there is none. */
export function withLlmCallContext<T>(fn: (ctx: LlmCallContext) => T): T {
  const existing = storage.getStore();
  if (existing) return fn(existing);
  const ctx: LlmCallContext = { attempts: [] };
  return storage.run(ctx, () => fn(ctx));
}

/** Always start a fresh context (one per instrumented call). */
export function runInNewLlmCallContext<T>(fn: (ctx: LlmCallContext) => T): T {
  const ctx: LlmCallContext = { attempts: [] };
  return storage.run(ctx, () => fn(ctx));
}

/** Compact, schema-free description stored in JuryLlmCallLog.model, e.g. "gemini-2.5-flash;fallback;req=2". */
export function describeLlmCallModel(ctx: LlmCallContext | undefined): string | null {
  if (!ctx || ctx.attempts.length === 0) return null;
  const model = ctx.respondedModel ?? ctx.attempts[ctx.attempts.length - 1];
  const parts = [ctx.respondedModel ? model : `${model}(no-response)`];
  if (ctx.attempts.length > 1) parts.push('fallback');
  parts.push(`req=${ctx.attempts.length}`);
  return parts.join(';').slice(0, 120);
}
