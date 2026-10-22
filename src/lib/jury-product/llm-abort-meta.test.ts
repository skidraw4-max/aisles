import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReviewBoardLlm } from '../ai-review-board/llm';
import { currentLlmCallContext, describeLlmCallModel } from '../llm-call-context';
import { createLlmCallRecorder, instrumentReviewBoardLlm, withLlmBudget } from './llm-call-log';

/** Fake transport mimicking geminiJson: records attempts, honours the signal. */
function fakeProvider(opts: { models: string[]; hangMs?: number }) {
  const seen: { aborted: boolean }[] = [];
  const llm = {
    async critic() {
      const ctx = currentLlmCallContext();
      for (const m of opts.models.slice(0, -1)) ctx?.attempts.push(m); // non-JSON -> fallback
      const last = opts.models[opts.models.length - 1];
      ctx?.attempts.push(last);
      if (opts.hangMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.hangMs);
          ctx?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            seen.push({ aborted: true });
            reject(ctx.signal!.reason);
          });
        });
      }
      if (ctx) ctx.respondedModel = last;
      return { ok: true };
    },
  };
  return { llm: llm as unknown as ReviewBoardLlm, seen };
}

test('D-16: per-call timeout aborts the in-flight request and is logged as LLM_TIMEOUT', async () => {
  const { llm, seen } = fakeProvider({ models: ['gemini-2.5-flash-lite'], hangMs: 5000 });
  const rec = createLlmCallRecorder();
  const wrapped = instrumentReviewBoardLlm(withLlmBudget(llm, { perCallMs: 30, totalMs: null }), { provider: 'gemini' }, rec) as unknown as Record<string, () => Promise<unknown>>;
  await assert.rejects(wrapped.critic(), /LLM_TIMEOUT/);
  assert.equal(seen.length, 1);
  assert.equal(rec.calls[0].errorCode, 'LLM_TIMEOUT');
  assert.equal(rec.calls[0].model, 'gemini-2.5-flash-lite(no-response);req=1');
});

test('D-16: responding model and fallback re-request are recorded in model (no schema change)', async () => {
  const { llm } = fakeProvider({ models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'] });
  const rec = createLlmCallRecorder();
  const wrapped = instrumentReviewBoardLlm(withLlmBudget(llm, { perCallMs: 1000, totalMs: null }), { provider: 'gemini' }, rec) as unknown as Record<string, () => Promise<unknown>>;
  assert.deepEqual(await wrapped.critic(), { ok: true });
  assert.equal(rec.calls[0].status, 'OK');
  assert.equal(rec.calls[0].model, 'gemini-2.5-flash;fallback;req=2');
});

test('D-16: no transport info keeps meta.model; describe handles empty', async () => {
  const rec = createLlmCallRecorder();
  const plain = { async critic() { return 1; } } as unknown as ReviewBoardLlm;
  const w = instrumentReviewBoardLlm(plain, { provider: 'p', model: 'm' }, rec) as unknown as Record<string, () => Promise<unknown>>;
  await w.critic();
  assert.equal(rec.calls[0].model, 'm');
  assert.equal(describeLlmCallModel(undefined), null);
});
