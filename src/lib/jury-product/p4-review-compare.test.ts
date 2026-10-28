/**
 * P4 (JD t568): link to the previous result + proposal comparison, stored in finalSurface (no migration).
 * Run: npx tsx --test src/lib/jury-product/p4-review-compare.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareWithPrevious, readPreviousComparison, COMPARISON_LIMIT } from './review-compare';

const p = (problem: string, goal?: string) => ({ problem, ...(goal ? { goal } : {}), evidence: '', evidenceBasis: 'general', steps: ['s'], priority: '중간', expectedEffect: '', verification: [], unverified: true, dissent: '' });
const surf = (...ps: object[]) => ({ improvementProposals: ps, improvementProposalsOmitted: null });

test('marks 해결됨 / 남음 / 새로 생김 (goal first, punctuation/space-insensitive)', () => {
  const prev = { id: 'r1', completedAt: new Date('2026-10-01T00:00:00Z'), finalSurface: surf(p('A 문제', '검색 쉽게'), p('B 문제')) };
  const c = compareWithPrevious(prev, surf(p('다른 문장', '검색  쉽게!'), p('C 문제')));
  assert.ok(c);
  assert.equal(c.previousResultId, 'r1');
  assert.equal(c.previousCompletedAt, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(c.items.map((i) => i.status), ['남음', '새로 생김', '해결됨']);
  assert.equal(c.items[2].label, 'B 문제');
});

test('no previous or older-format side => no comparison', () => {
  assert.equal(compareWithPrevious(null, surf(p('a'))), null);
  assert.equal(compareWithPrevious({ id: 'x', completedAt: '2026-01-01', finalSurface: { topProblems: ['a'] } }, surf(p('a'))), null);
  assert.equal(compareWithPrevious({ id: 'x', completedAt: '2026-01-01', finalSurface: { improvementProposals: [], improvementProposalsOmitted: 'SECRET' } }, surf(p('a'))), null);
});

test('capped; display read is tolerant and old results show nothing', () => {
  const many = (tag: string) => Array.from({ length: 9 }, (_, i) => p(`${tag}${i}`));
  const c = compareWithPrevious({ id: 'x', completedAt: '2026-01-01T00:00:00Z', finalSurface: surf(...many('이전')) }, surf(...many('이번')));
  assert.equal(c?.items.length, COMPARISON_LIMIT);
  assert.equal(readPreviousComparison({ statusSummary: 's' }), null);
  assert.equal(readPreviousComparison(null), null);
  const r = readPreviousComparison({ previousComparison: { previousResultId: 'x', previousCompletedAt: 'z', items: [{ label: 'a', status: '남음' }, { label: 'b', status: '??' }] } });
  assert.deepEqual(r?.items, [{ label: 'a', status: '남음' }]);
});

test('connected-service review links via finalSurface; lineage column untouched (no migration)', () => {
  const src = readFileSync('src/lib/jury-product/connected-service-review.ts', 'utf8');
  assert.ok(src.includes('previousComparison: comparison'));
  assert.equal(/parentReviewResultId/.test(src), false);
});
