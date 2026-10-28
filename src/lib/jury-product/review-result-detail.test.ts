/**
 * RM-07 done criterion: "실결과 3건 이상에서 UI-05 체크리스트 통과".
 * Production result SHAPES (counts/decisions/sources read-only from DB earlier; text synthetic, no PII)
 * run through projectReviewConsole -> AGG-01 -> buildResultDetailView.
 * UI-05 checklist = M-002/003/004/005/008/009/015/016/017 + CT-01..CT-12 mapped to UI-05.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectReviewConsole } from './review-console';
import { buildReviewDisplayModel } from './review-display-model';
import { buildResultDetailView, type ResultDetailView } from './review-result-detail';
import type { JuryActor } from './access';
import type { JuryFinalSurface } from './records';

const actor: JuryActor = { ok: true, userId: 'u', tenantId: 't', role: 'OWNER', membershipId: 'm' };
const n = (k: number, p: string) => Array.from({ length: k }, (_, i) => `${p} ${i}`);
const surface = (o: Partial<JuryFinalSurface>): JuryFinalSurface => ({
  statusSummary: 's', topProblems: [], expectedUserEffect: '', risk: '', dimensionEvidence: [],
  supportedClaims: [], partiallySupportedClaims: [], hypotheses: [], ...o,
});

type Shape = {
  decision: 'ACCEPT' | 'VERIFY' | 'REWORD';
  surface: JuryFinalSurface;
  facts?: Record<string, unknown>;
  metrics?: { id: string; metric: string; value: number | null; availability: 'AVAILABLE' | 'NOT_MEASURED' }[];
  evidence?: boolean;
};

function view(shape: Shape): ResultDetailView {
  const out = projectReviewConsole({
    actor,
    result: { id: 'r', tenantId: 't', expectedDecision: shape.decision, finalSurface: shape.surface, completedAt: '2026-10-01T00:00:00.000Z', evidenceStrength: 'moderate' },
    status: 'COMPLETED',
    evidenceId: shape.evidence === false ? null : 'e',
    metrics: shape.metrics ?? [{ id: 'm1', metric: 'x', value: 1, availability: 'AVAILABLE' }],
    displayFacts: { metricIds: (shape.metrics ?? [{ metric: 'x' }]).map((m) => m.metric), ...shape.facts },
  });
  assert.equal(out.ok, true);
  if (!out.ok || !out.screen.display) throw new Error('no display');
  return buildResultDetailView(out.screen.display);
}

/** Generic UI-05 checks every result must pass. */
function ui05(v: ResultDetailView) {
  const all = JSON.stringify(v);
  // no composite score, no severity buckets (D-13), no "no problem" wording for missing data
  assert.equal(/종합 점수|점수|심각도 (높음|중간|낮음)/.test(all), false, 'no score / severity');
  assert.equal(/문제 없음|특이 사항 없음|조치가 필요하지 않/.test(all), false, 'missing data never "no problem"');
  // fixed summary shape
  assert.deepEqual(v.summary.facts.map((f) => f.label), ['문제', '주장 확인 현황', '부족한 근거', '검사 범위', '근거 강도', '위원 의견']);
  assert.deepEqual(v.comparison.map((c) => c.step), ['주장', '근거', '결론', '기대']);
  // every listed problem carries a cause link to the evidence tab (PC-03: result-level evidence)
  for (const item of v.problems.items) assert.equal(item.cause.tab, 'evidence');
}

const fact = (v: ResultDetailView, label: string) => v.summary.facts.find((f) => f.label === label)?.value;

test('real shape 2f6638a0 (VERIFY, 5 problems, 0 claims) passes UI-05', () => {
  const v = view({ decision: 'VERIFY', surface: surface({ topProblems: n(5, 'problem') }) });
  ui05(v);
  assert.equal(fact(v, '문제'), '5건 (심각도 미기록 5건)');
  assert.equal(fact(v, '주장 확인 현황'), '주장 기록 없음'); // CT-02
  assert.equal(fact(v, '부족한 근거'), '집계 불가');
  assert.equal(v.problems.items.length, 5);
  assert.equal(v.summary.source.tone, 'LEGACY'); // M-015
});

test('real shape 6adbe715 (VERIFY, 0 problems, claims 15/21/10) passes UI-05', () => {
  const v = view({ decision: 'VERIFY', surface: surface({ supportedClaims: n(15, 's'), partiallySupportedClaims: n(21, 'p'), hypotheses: n(10, 'h') }) });
  ui05(v);
  assert.equal(fact(v, '문제'), '문제 목록 없음 — 결론과 불일치'); // CT-03
  assert.equal(fact(v, '주장 확인 현황'), '확인 15 · 일부 확인 21 · 미확인 10');
  assert.equal(fact(v, '부족한 근거'), '31개');
  assert.equal(v.problems.state, 'EMPTY');
});

test('real shape 10a856f7 (REWORD, 5 problems, 22/1/1, 1 metric) passes UI-05', () => {
  const v = view({ decision: 'REWORD', surface: surface({ topProblems: n(5, 'p'), supportedClaims: n(22, 's'), partiallySupportedClaims: ['a'], hypotheses: ['b'], expectedUserEffect: 'effect' }) });
  ui05(v);
  assert.equal(v.summary.decision, '수정 필요');
  assert.equal(fact(v, '검사 범위'), '지표 1개 · 미검사 0개'); // CT-04
  assert.equal(v.comparison[3].note, 'AI 추정');
  assert.equal(v.unchecked.state, 'NONE');
});

test('fixture shape aa734100 (REWORD, nothing recorded, FIXTURE) passes UI-05 with badge and warnings', () => {
  const v = view({ decision: 'REWORD', surface: surface({}), facts: { boardRunId: 'fixture-reword-x' } });
  ui05(v);
  assert.equal(v.summary.source.tone, 'NON_REAL'); // CT-10
  assert.match(v.summary.source.note ?? '', /집계에서 제외/);
  assert.equal(fact(v, '문제'), '문제 목록 없음 — 결론과 불일치'); // CT-01
  assert.ok(v.summary.warnings.length >= 3);
});

test('mock shape 37072025 (MOCK source) passes UI-05 with Mock badge', () => {
  const v = view({ decision: 'VERIFY', surface: surface({ topProblems: ['p'], supportedClaims: ['s'] }), facts: { resultSource: 'MOCK' } });
  ui05(v);
  assert.equal(v.summary.source.label, 'Mock 결과');
  assert.equal(v.summary.source.tone, 'NON_REAL');
});

test('CT-09: no evidence -> verdict withheld, scope "근거 미연결", unchecked unknown', () => {
  const v = view({ decision: 'REWORD', surface: surface({ topProblems: ['p'] }), evidence: false });
  ui05(v);
  assert.ok(v.summary.decisionNote?.startsWith('결론 표시 보류'));
  assert.equal(fact(v, '검사 범위'), '근거 미연결');
  assert.equal(v.unchecked.state, 'UNKNOWN');
});

test('M-008: 미검사 목록 lists NOT_MEASURED metrics from the same model as the count', () => {
  const v = view({
    decision: 'VERIFY',
    surface: surface({ topProblems: ['p'], supportedClaims: ['s'] }),
    metrics: [
      { id: '1', metric: 'newUsersLast7d', value: 0, availability: 'AVAILABLE' },
      { id: '2', metric: 'postsLast7d', value: null, availability: 'NOT_MEASURED' },
    ],
  });
  ui05(v);
  assert.deepEqual(v.unchecked.items, ['postsLast7d']);
  assert.equal(fact(v, '검사 범위'), '지표 2개 · 미검사 1개');
});

test('CT-06: invalid finalSurface -> counts not shown (model level; console projection is RM-07b)', () => {
  const display = buildReviewDisplayModel({
    result: { id: 'r', expectedDecision: 'VERIFY', finalSurface: { statusSummary: 's' } },
    request: { status: 'COMPLETED' },
    evidence: { id: 'e', metricIds: ['x'], metrics: [{ availability: 'AVAILABLE', metric: 'x' }] },
  });
  const v = buildResultDetailView(display);
  assert.equal(fact(v, '문제'), '집계 불가');
  assert.equal(v.problems.state, 'UNAVAILABLE');
  assert.equal(fact(v, '주장 확인 현황'), '집계 불가');
});
