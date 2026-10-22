import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReviewBoardLlm } from '../ai-review-board/llm';
import { readLlmBudget, withLlmBudget } from './llm-call-log';
import { buildRequestStatusRows, failureReasonLabel } from './review-request-status';
import type { JuryReviewAttemptRow } from './console-view';

const attempt = (o: Partial<JuryReviewAttemptRow>): JuryReviewAttemptRow => ({
  id: 'a', tenantId: 't', reviewRequestKey: 'k', evidenceId: 'e', connectionId: 'c', reviewType: 'FULL_REVIEW',
  status: 'FAILED', failureReason: 'REVIEW_NOT_EXECUTED', resultSource: 'REAL_MODEL',
  startedAt: '2026-10-22T00:00:00.000Z', finishedAt: '2026-10-22T00:01:00.000Z', lastLlmErrorCode: null, ...o,
});
const NOW = Date.parse('2026-10-22T01:00:00.000Z');

test('CT-11 failed/running requests without result are listed with status, times and reason', () => {
  const rows = buildRequestStatusRows({
    requests: [],
    results: [{ reviewRequestId: 'done' } as never],
    attempts: [
      attempt({ id: '1', reviewRequestKey: 'k1', lastLlmErrorCode: 'LLM_TIMEOUT' }),
      attempt({ id: '2', reviewRequestKey: 'k1', startedAt: '2026-10-21T00:00:00.000Z' }),
      attempt({ id: '3', reviewRequestKey: 'k2', status: 'RUNNING', finishedAt: null, failureReason: null, startedAt: '2026-10-22T00:55:00.000Z' }),
      attempt({ id: '4', reviewRequestKey: 'k3', status: 'RUNNING', finishedAt: null, failureReason: null }),
      attempt({ id: '5', reviewRequestKey: 'done', status: 'COMPLETED' }),
      attempt({ id: '6', reviewRequestKey: 'k4', failureReason: null }),
    ],
  }, NOW);
  const by = new Map(rows.map((r) => [r.key, r]));
  assert.equal(by.has('done'), false);
  assert.equal(by.get('k1')?.state, 'FAILED');
  assert.equal(by.get('k1')?.attempts, 2);
  assert.equal(by.get('k1')?.reason, '심사를 실행하지 못했습니다 (AI 호출 시간 초과)');
  assert.equal(by.get('k2')?.state, 'RUNNING');
  assert.equal(by.get('k2')?.reason, null);
  assert.equal(by.get('k3')?.state, 'STALE');
  assert.match(by.get('k3')?.reason ?? '', /시간 초과 추정/);
  assert.equal(by.get('k4')?.reason, '사유 미기록');
});

test('RM-03 legacy requests without attempts are listed with "기록 없음" times', () => {
  const rows = buildRequestStatusRows({
    requests: [{ id: 'q', evidenceId: 'e', reviewType: 'FULL_REVIEW', status: 'FAILED' } as never],
    results: [],
    attempts: [],
  }, NOW);
  assert.equal(rows[0]?.origin, 'REQUEST');
  assert.equal(rows[0]?.startedAt, null);
  assert.equal(rows[0]?.reason, '사유 미기록');
  assert.equal(failureReasonLabel('WEIRD', null), '사유 코드 WEIRD');
});

test('RM-03 LLM budget is inactive unless configured and rejects slow calls with fixed codes', async () => {
  assert.deepEqual(readLlmBudget({}), { perCallMs: null, totalMs: null });
  assert.deepEqual(readLlmBudget({ JURY_LLM_CALL_TIMEOUT_MS: '5', JURY_LLM_TOTAL_BUDGET_MS: '60000' }), { perCallMs: null, totalMs: 60000 });
  const slow = { critic: () => new Promise((resolve) => setTimeout(() => resolve('late'), 200)), chairman: async () => 'ok' } as unknown as ReviewBoardLlm;
  assert.equal(withLlmBudget(slow, { perCallMs: null, totalMs: null }), slow);
  const limited = withLlmBudget(slow, { perCallMs: 20, totalMs: null }) as unknown as Record<string, () => Promise<unknown>>;
  await assert.rejects(limited.critic!(), /LLM_TIMEOUT/);
  assert.equal(await limited.chairman!(), 'ok');
  let t = 0;
  const budget = withLlmBudget(slow, { perCallMs: null, totalMs: 1000 }, () => t) as unknown as Record<string, () => Promise<unknown>>;
  t = 2000;
  await assert.rejects(budget.chairman!(), /LLM_BUDGET_EXCEEDED/);
});
