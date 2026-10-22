import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewDisplayModel, resolveResultSource, type ReviewDisplayInput } from './review-display-model';

const surface = (o: Record<string, unknown> = {}) => ({
  statusSummary: 's', expectedUserEffect: '', risk: '', dimensionEvidence: [],
  topProblems: [], supportedClaims: [], partiallySupportedClaims: [], hypotheses: [], ...o,
});
const n = (k: number, p: string) => Array.from({ length: k }, (_, i) => `${p}${i}`);
const input = (decision: string, s: unknown, extra: Partial<ReviewDisplayInput> = {}, r: Record<string, unknown> = {}): ReviewDisplayInput => ({
  result: { id: 'r1', boardRunId: 'run-1', expectedDecision: decision, finalSurface: s, ...r },
  request: { status: 'COMPLETED', resultSource: 'REAL_MODEL' },
  evidence: { id: 'e1', metricIds: ['m1'], metrics: [{ availability: 'AVAILABLE' }] },
  ...extra,
});

test('CT-01 REWORD with no problems flags a mismatch and never reads as "no problem"', () => {
  const m = buildReviewDisplayModel(input('REWORD', surface()));
  assert.equal(m.problems.state, 'NONE_LISTED');
  assert.ok(m.flags.includes('DECISION_PROBLEM_MISMATCH'));
});

test('CT-02 VERIFY + 5 problems + 0 claims shows NONE_RECORDED, not 0 confirmed', () => {
  const m = buildReviewDisplayModel(input('VERIFY', surface({ topProblems: n(5, 'p') })));
  assert.equal(m.problems.count, 5);
  assert.equal(m.claims.state, 'NONE_RECORDED');
  assert.equal(m.claims.counts, null);
  assert.equal(m.missingEvidenceCount, null);
  assert.ok(m.flags.includes('NO_CLAIMS'));
});

test('CT-03 VERIFY + 0 problems + claims 15/21/10', () => {
  const m = buildReviewDisplayModel(input('VERIFY', surface({ supportedClaims: n(15, 's'), partiallySupportedClaims: n(21, 'p'), hypotheses: n(10, 'h') })));
  assert.equal(m.problems.state, 'NONE_LISTED');
  assert.deepEqual(m.claims.counts, { supported: 15, partial: 21, unverified: 10 });
  assert.ok(m.flags.includes('PARTIAL_CONFIRMATION'));
});

test('CT-04 normal REWORD with one metric in scope', () => {
  const m = buildReviewDisplayModel(input('REWORD', surface({ topProblems: n(5, 'p'), supportedClaims: n(22, 's'), partiallySupportedClaims: ['a'], hypotheses: ['b'] })));
  assert.equal(m.decision.label, '수정 필요');
  assert.equal(m.decision.withheld, false);
  assert.equal(m.scope.metricCount, 1);
  assert.equal(m.flags.includes('DECISION_PROBLEM_MISMATCH'), false);
});

test('CT-05 missing-evidence count comes from the same function as the claims', () => {
  const m = buildReviewDisplayModel(input('VERIFY', surface({ supportedClaims: ['a'], partiallySupportedClaims: ['b'], hypotheses: ['c', 'd'] }), {}, { evidenceStrength: 'unknown' }));
  assert.equal(m.missingEvidenceCount, 3);
  assert.equal(m.strength.evidence, '판단 불가');
});

test('CT-06 missing required key => schema invalid, no numbers', () => {
  const m = buildReviewDisplayModel(input('VERIFY', { statusSummary: 'x' }));
  assert.equal(m.schemaValid, false);
  assert.equal(m.decision.withheld, true);
  assert.equal(m.problems.count, null);
  assert.equal(m.claims.counts, null);
  assert.ok(m.flags.includes('SCHEMA_INVALID'));
  assert.equal(buildReviewDisplayModel(input('MAYBE', surface())).schemaValid, false);
});

test('CT-07 string problems carry no severity', () => {
  const m = buildReviewDisplayModel(input('VERIFY', surface({ topProblems: ['a', 'b'] })));
  assert.equal(m.problems.severity, null);
  assert.equal(m.problems.severityNote, '심각도 미기록 2건');
});

test('CT-08 duplicate claim counted once at highest stage', () => {
  const m = buildReviewDisplayModel(input('VERIFY', surface({ topProblems: ['x', 'x '], supportedClaims: ['Same claim'], partiallySupportedClaims: ['same  claim', 'other'] })));
  assert.deepEqual(m.claims.counts, { supported: 1, partial: 1, unverified: 0 });
  assert.equal(m.problems.count, 1);
  assert.ok(m.flags.includes('DUPLICATE_CLAIM'));
  assert.ok(m.flags.includes('DUPLICATE_PROBLEM'));
});

test('CT-09 unlinked evidence withholds the verdict', () => {
  for (const evidence of [null, { id: 'e', metricIds: [], metrics: [] }]) {
    const m = buildReviewDisplayModel(input('ACCEPT', surface({ supportedClaims: ['a'] }), { evidence }));
    assert.equal(m.scope.state, 'UNLINKED');
    assert.equal(m.decision.withheld, true);
    assert.ok(m.flags.includes('NO_EVIDENCE'));
  }
  assert.equal(buildReviewDisplayModel(input('ACCEPT', surface(), { evidence: undefined })).scope.state, 'NOT_LOADED');
});

test('CT-10 MOCK/FIXTURE labeled and excluded; VERIFIED_REAL never derived', () => {
  const mock = buildReviewDisplayModel(input('VERIFY', surface(), { request: { resultSource: 'MOCK' } }));
  assert.equal(mock.source.label, 'Mock 결과');
  assert.equal(mock.source.countsTowardAggregates, false);
  assert.ok(mock.flags.includes('NON_REAL_SOURCE'));
  assert.deepEqual(resolveResultSource(null, 'fixture-reword-phase16'), { value: 'FIXTURE', inferredFromLegacy: true });
  assert.equal(resolveResultSource('UNKNOWN_LEGACY', 'run').value, 'UNKNOWN_LEGACY');
  const real = buildReviewDisplayModel(input('VERIFY', surface()));
  assert.equal(real.source.value, 'REAL_MODEL');
  assert.equal(real.source.countsTowardAggregates, false);
  assert.equal(buildReviewDisplayModel(input('VERIFY', surface(), { request: { resultSource: 'VERIFIED_REAL' } })).source.countsTowardAggregates, true);
});

test('CT-11 failed request without result shows execution state, empty verdict', () => {
  const m = buildReviewDisplayModel({ result: null, request: { status: 'FAILED', failureReason: 'REVIEW_NOT_EXECUTED', resultSource: 'REAL_MODEL' } });
  assert.equal(m.decision.withheld, true);
  assert.equal(m.execution.failureReason, 'REVIEW_NOT_EXECUTED');
  assert.ok(m.flags.includes('NO_RESULT'));
});

test('CT-12 revisionRequired with ACCEPT flags a mismatch and keeps the raw verdict', () => {
  const m = buildReviewDisplayModel(input('ACCEPT', surface({ supportedClaims: ['a'] }), {}, { revisionRequired: true }));
  assert.equal(m.decision.raw, 'ACCEPT');
  assert.ok(m.flags.includes('DECISION_REVISION_MISMATCH'));
});

test('M-012 composite score is never produced; AI inference stays labeled', () => {
  const m = buildReviewDisplayModel(input('VERIFY', surface({ risk: 'r' })));
  assert.equal(m.compositeScore, null);
  assert.deepEqual(m.aiInference, { label: 'AI 추정', expectedUserEffect: null, risk: 'r' });
});

import { cycleStatusLabel, displayModelForCatalogRow, summarizeDisplayModels, summarizeProblems } from './review-display-model';

test('RM-02b summarizeProblems never says "없음" and flags verdict mismatch', () => {
  assert.equal(summarizeProblems('REWORD', []).emptyText, '문제 목록 없음 — 판정과 불일치');
  assert.equal(summarizeProblems('ACCEPT', []).emptyText, '문제 목록 없음');
  assert.equal(summarizeProblems('VERIFY', 'x').state, 'UNAVAILABLE');
  assert.equal(summarizeProblems('VERIFY', ['a', 'a']).count, 1);
});

test('RM-02b catalog rows: hidden evidence is NOT_LOADED, missing link is UNLINKED; summary excludes non-real', () => {
  const result = { id: 'r', expectedDecision: 'VERIFY', finalSurface: surface({ topProblems: ['p'] }), boardRunId: 'fixture-x' };
  const hidden = displayModelForCatalogRow(result, { evidenceId: 'e9' }, []);
  assert.equal(hidden.scope.state, 'NOT_LOADED');
  assert.equal(hidden.decision.withheld, false);
  const unlinked = displayModelForCatalogRow(result, { evidenceId: null }, []);
  assert.equal(unlinked.scope.state, 'UNLINKED');
  const linked = displayModelForCatalogRow(result, { evidenceId: 'e1', resultSource: 'MOCK' }, [{ id: 'e1', metricIds: ['m'] }]);
  assert.equal(linked.scope.metricCount, 1);
  const sum = summarizeDisplayModels([hidden, linked, buildReviewDisplayModel(input('VERIFY', surface({ topProblems: ['p'] })))]);
  assert.deepEqual(sum, { total: 3, aggregatable: 0, realUnverified: 1, nonReal: 2, unknownSource: 0, withWarnings: 3 }); // NO_CLAIMS on all three
});

test('RM-02b automation cycle ACTIVE is not shown as running when the loop is off', () => {
  assert.equal(cycleStatusLabel('ACTIVE', false), '결정 대기 (자동 실행 아님)');
  assert.equal(cycleStatusLabel('ACTIVE', true), '진행 중 (자동 Loop 켜짐)');
});
