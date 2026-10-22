import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReviewBoardLlm } from '../ai-review-board/llm';
import { createLlmCallRecorder, instrumentReviewBoardLlm, llmErrorCode } from './llm-call-log';

test('RM-01 LLM wrapper forwards calls unchanged and keeps metadata only', async () => {
  let t = 1000;
  const fake = {
    async critic(evidence: unknown) {
      t += 25;
      return { echoed: evidence };
    },
    async chairman() {
      t += 5;
      const error = new Error('prompt text secret-ish') as Error & { status: number };
      error.status = 429;
      throw error;
    },
  } as unknown as ReviewBoardLlm;
  const rec = createLlmCallRecorder();
  const llm = instrumentReviewBoardLlm(fake, { provider: 'gemini', model: 'm' }, rec, () => t);
  const pack = { secret: 'EVIDENCE BODY' };
  const out = await (llm as unknown as { critic(e: unknown): Promise<unknown> }).critic(pack);
  assert.deepEqual(out, { echoed: pack });
  await assert.rejects((llm as unknown as { chairman(): Promise<unknown> }).chairman(), /prompt text/);
  assert.equal(rec.calls.length, 2);
  assert.deepEqual(
    rec.calls.map((c) => [c.seq, c.operation, c.status, c.errorCode, c.latencyMs]),
    [
      [0, 'critic', 'OK', null, 25],
      [1, 'chairman', 'ERROR', 'HTTP_429', 5],
    ],
  );
  assert.equal(JSON.stringify(rec.calls).includes('EVIDENCE BODY'), false);
  assert.equal(JSON.stringify(rec.calls).includes('prompt text'), false);
});

test('RM-01 LLM error codes never carry free text', () => {
  assert.equal(llmErrorCode(new Error('MISSING_GEMINI_KEY')), 'MISSING_GEMINI_KEY');
  assert.equal(llmErrorCode(new Error('some long message with key=abc')), 'LLM_ERROR');
  assert.equal(llmErrorCode({ name: 'AbortError' }), 'TIMEOUT');
});

test('RM-01 recorder caps stored calls', () => {
  const rec = createLlmCallRecorder(2);
  for (let i = 0; i < 5; i++) {
    rec.push({ provider: 'p', model: null, operation: 'o', memberId: null, status: 'OK', errorCode: null, latencyMs: 0, startedAt: '' });
  }
  assert.equal(rec.calls.length, 2);
});
