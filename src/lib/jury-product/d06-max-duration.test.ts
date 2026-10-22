import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readLlmBudget } from './llm-call-log';

test('D-06: jury segment maxDuration (300s) exceeds the approved total LLM budget (240s)', () => {
  const src = readFileSync('src/app/(jury)/jury/layout.tsx', 'utf8');
  const m = src.match(/export const maxDuration = (\d+);/);
  assert.ok(m, 'maxDuration exported from jury layout');
  const maxMs = Number(m![1]) * 1000;
  const b = readLlmBudget({ JURY_LLM_CALL_TIMEOUT_MS: '60000', JURY_LLM_TOTAL_BUDGET_MS: '240000' } as NodeJS.ProcessEnv);
  assert.equal(b.perCallMs, 60000);
  assert.equal(b.totalMs, 240000);
  assert.ok(maxMs > (b.totalMs as number) && (b.perCallMs as number) <= (b.totalMs as number));
});
