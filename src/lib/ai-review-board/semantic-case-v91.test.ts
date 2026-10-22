/**
 * v9.1 CASE-01…10 — must catch Judge misjudgments (null measurement vs null-as-negative, etc.)
 * Run: node --import tsx --test src/lib/ai-review-board/semantic-case-v91.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateReferenceCase,
  loadSemanticReferenceCases,
  runSemanticReferenceEvaluation,
  scanChairmanReliability,
  compareCalibrationJudgeMismatch,
} from './semantic-reference-eval';
import { buildStubEvidencePack } from './evidence-pack';
import { adjudicateClaimDeterministic } from './semantic-judge';
import { judgeActionsEquivalent } from './types';

describe('v9.1 CASE-01…10 regression', () => {
  const cases = loadSemanticReferenceCases().filter((c) => c.id.startsWith('CASE-'));

  it('loads CASE-01…10 without removing SEM-*', () => {
    const all = loadSemanticReferenceCases();
    assert.equal(all.filter((c) => c.id.startsWith('SEM-')).length, 15);
    assert.equal(cases.length, 10);
  });

  it('NO_ACTION_NEEDED aliases NO_CHANGE', () => {
    assert.equal(judgeActionsEquivalent('NO_ACTION_NEEDED', 'NO_CHANGE'), true);
    assert.equal(judgeActionsEquivalent('REWORD', 'NO_CHANGE'), false);
  });

  it('CASE-01: null metrics → measurement gap SUPPORTED (not low activity)', () => {
    const c = cases.find((x) => x.id === 'CASE-01')!;
    const r = evaluateReferenceCase(c);
    assert.equal(r.actual.supportLevel, 'SUPPORTED');
    assert.equal(r.actual.evidenceRelation, 'DIRECTLY_SUPPORTS');
    assert.equal(r.actual.semanticLeap, 'NONE');
    assert.ok(judgeActionsEquivalent(r.actual.recommendedAction, c.expectedAction));
    assert.equal(r.match.semanticLeap, true);
    assert.equal(r.match.support, true);
  });

  it('CASE-02: null → dormant/non-existent is UNKNOWN_AS_NEGATIVE', () => {
    const c = cases.find((x) => x.id === 'CASE-02')!;
    const r = evaluateReferenceCase(c);
    assert.equal(r.actual.semanticLeap, 'UNKNOWN_AS_NEGATIVE_EVIDENCE');
    assert.equal(r.actual.supportLevel, 'NOT_SUPPORTED');
    assert.notEqual(r.actual.semanticLeap, 'NONE');
  });

  it('CASE-01 vs CASE-02 must diverge on leap', () => {
    const a = evaluateReferenceCase(cases.find((x) => x.id === 'CASE-01')!);
    const b = evaluateReferenceCase(cases.find((x) => x.id === 'CASE-02')!);
    assert.equal(a.actual.semanticLeap, 'NONE');
    assert.equal(b.actual.semanticLeap, 'UNKNOWN_AS_NEGATIVE_EVIDENCE');
  });

  it('CASE-03: UI/UX causal leap', () => {
    const r = evaluateReferenceCase(cases.find((x) => x.id === 'CASE-03')!);
    assert.equal(r.actual.semanticLeap, 'FACT_TO_CAUSALITY');
    assert.equal(r.actual.supportLevel, 'NOT_SUPPORTED');
  });

  it('CASE-04: benchmark trend gap without benchmark', () => {
    const r = evaluateReferenceCase(cases.find((x) => x.id === 'CASE-04')!);
    assert.equal(r.actual.semanticLeap, 'FACT_TO_TREND');
    assert.equal(r.actual.supportLevel, 'NOT_SUPPORTED');
  });

  it('CASE-05: LOUNGE ratio is direct calc, no leap', () => {
    const r = evaluateReferenceCase(cases.find((x) => x.id === 'CASE-05')!);
    assert.equal(r.actual.supportLevel, 'SUPPORTED');
    assert.equal(r.actual.semanticLeap, 'NONE');
  });

  it('CASE-06: corridor scope overclaim', () => {
    const r = evaluateReferenceCase(cases.find((x) => x.id === 'CASE-06')!);
    assert.equal(r.actual.semanticLeap, 'FACT_TO_GLOBAL_CONCLUSION');
    assert.equal(r.actual.supportLevel, 'PARTIALLY_SUPPORTED');
  });

  it('CASE-07: posts continuity supported without quality leap', () => {
    const r = evaluateReferenceCase(cases.find((x) => x.id === 'CASE-07')!);
    assert.equal(r.actual.supportLevel, 'SUPPORTED');
    assert.equal(r.actual.semanticLeap, 'NONE');
  });

  it('CASE-08: comments=0 ≠ platform-wide engagement crisis', () => {
    const r = evaluateReferenceCase(cases.find((x) => x.id === 'CASE-08')!);
    assert.equal(r.actual.semanticLeap, 'FACT_TO_GLOBAL_CONCLUSION');
    assert.equal(r.actual.supportLevel, 'NOT_SUPPORTED');
  });

  it('CASE-09: quantity ≠ quality', () => {
    const r = evaluateReferenceCase(cases.find((x) => x.id === 'CASE-09')!);
    assert.equal(r.actual.semanticLeap, 'TECH_STACK_TO_QUALITY');
    assert.equal(r.actual.supportLevel, 'NOT_SUPPORTED');
  });

  it('CASE-10: Gemini presence ≠ engagement effect', () => {
    const r = evaluateReferenceCase(cases.find((x) => x.id === 'CASE-10')!);
    assert.equal(r.actual.semanticLeap, 'FACT_TO_CAUSALITY');
    assert.equal(r.actual.supportLevel, 'NOT_SUPPORTED');
  });

  it('all CASE-01…10 match support + leap expected', () => {
    const fails = cases
      .map(evaluateReferenceCase)
      .filter((r) => !r.match.support || !r.match.semanticLeap);
    assert.equal(
      fails.length,
      0,
      fails.map((f) => `${f.id}:${f.actual.supportLevel}/${f.actual.semanticLeap}`).join(', '),
    );
  });

  it('chairman reliability flags catch null→low and quantity→quality', () => {
    const flags = scanChairmanReliability({
      confirmedFacts: ['activeUsersLast7d is null so activity is low'],
      hypotheses: ['many posts mean high content quality'],
      statusSummary: 'Gemini integration increases engagement',
    });
    assert.ok(flags.some((f) => f.includes('NULL_AS_LOW') || f.includes('UNKNOWN_AS_NEGATIVE')));
    assert.ok(flags.some((f) => f.includes('QUANTITY_AS_QUALITY') || f.includes('QUALITY')));
    assert.ok(flags.some((f) => f.includes('PRESENCE_AS_EFFECT') || f.includes('CAUSAL')));
  });

  it('calibration/judge mismatchType classification', () => {
    assert.equal(
      compareCalibrationJudgeMismatch(
        { supportLevel: 'SUPPORTED', evidenceRelation: 'DIRECTLY_SUPPORTS' },
        { supportLevel: 'NOT_SUPPORTED', evidenceRelation: 'DOES_NOT_SUPPORT' },
      ),
      'JUDGE_STRICTER',
    );
    assert.equal(
      compareCalibrationJudgeMismatch(
        { supportLevel: 'NOT_SUPPORTED', evidenceRelation: 'DOES_NOT_SUPPORT' },
        { supportLevel: 'SUPPORTED', evidenceRelation: 'DIRECTLY_SUPPORTS' },
      ),
      'CALIBRATION_STRICTER',
    );
    assert.equal(
      compareCalibrationJudgeMismatch(
        { supportLevel: 'SUPPORTED', evidenceRelation: 'DIRECTLY_SUPPORTS' },
        { supportLevel: 'SUPPORTED', evidenceRelation: 'DIRECTLY_SUPPORTS' },
      ),
      'NONE',
    );
  });

  it('SEM suite still fully green alongside CASE suite', () => {
    const { results } = runSemanticReferenceEvaluation();
    const semFails = results
      .filter((r) => r.id.startsWith('SEM-'))
      .filter((r) => !r.match.support || !r.match.semanticLeap);
    assert.equal(semFails.length, 0);
  });
});

describe('v9.1 adjudicator edge wording', () => {
  const pack = buildStubEvidencePack({
    aggregates: {
      activeUsersLast7d: null,
      viewsLast7d: null,
      newUsersLast7d: 0,
      commentsLast7d: 0,
      postsLast7d: 141,
      postCount: 3372,
      postsByCategory: { LOUNGE: 3284 },
    },
  });

  it('dormant wording triggers unknown-as-negative', () => {
    const r = adjudicateClaimDeterministic(
      'activeUsersLast7d가 null이므로 활성 사용자 기반이 dormant 상태다.',
      pack,
    );
    assert.equal(r.semanticLeap.type, 'UNKNOWN_AS_NEGATIVE_EVIDENCE');
  });
});
