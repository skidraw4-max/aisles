/**
 * Run: node --import tsx --test src/lib/ai-review-board/semantic-reference-eval.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyChairmanBucket,
  evaluateReferenceCase,
  loadSemanticReferenceCases,
  measureRevisionInfluence,
  runSemanticReferenceEvaluation,
} from './semantic-reference-eval';
import { collectOverlayFlags } from './semantic-judge';
import { buildStubEvidencePack } from './evidence-pack';

describe('semantic reference evaluation (v9)', () => {
  it('loads 15 human SEM reference cases (CASE-* may also exist)', () => {
    const cases = loadSemanticReferenceCases().filter((c) => c.id.startsWith('SEM-'));
    assert.equal(cases.length, 15);
    assert.ok(cases.every((c) => c.id.startsWith('SEM-')));
    assert.ok(cases.filter((c) => c.chairmanProbe).length >= 5);
  });

  it('evaluates all cases and reports metrics (no throw)', () => {
    const report = runSemanticReferenceEvaluation();
    assert.ok(report.results.length >= 15);
    assert.equal(report.metrics.cases, report.results.length);
    assert.ok(report.metrics.classificationAccuracy >= 0);
    assert.ok(report.metrics.supportAccuracy >= 0);
  });

  it('SEM-001 direct fact passes', () => {
    const c = loadSemanticReferenceCases().find((x) => x.id === 'SEM-001')!;
    const r = evaluateReferenceCase(c);
    assert.equal(r.match.support, true);
    assert.equal(r.match.semanticLeap, true);
    assert.equal(r.actual.semanticLeap, 'NONE');
  });

  it('SEM-005 unknown-as-negative detected', () => {
    const c = loadSemanticReferenceCases().find((x) => x.id === 'SEM-005')!;
    const r = evaluateReferenceCase(c);
    assert.equal(r.actual.semanticLeap, 'UNKNOWN_AS_NEGATIVE_EVIDENCE');
    assert.equal(r.match.semanticLeap, true);
  });

  it('SEM-006 causal leap detected', () => {
    const c = loadSemanticReferenceCases().find((x) => x.id === 'SEM-006')!;
    const r = evaluateReferenceCase(c);
    assert.equal(r.actual.semanticLeap, 'FACT_TO_CAUSALITY');
  });

  it('SEM-008 trend leap detected', () => {
    const c = loadSemanticReferenceCases().find((x) => x.id === 'SEM-008')!;
    const r = evaluateReferenceCase(c);
    assert.equal(r.actual.semanticLeap, 'FACT_TO_TREND');
  });

  it('SEM-012 tech quality leap detected', () => {
    const c = loadSemanticReferenceCases().find((x) => x.id === 'SEM-012')!;
    const r = evaluateReferenceCase(c);
    assert.equal(r.actual.semanticLeap, 'TECH_STACK_TO_QUALITY');
  });

  it('SEM-014 valid dual observation not over-downgraded', () => {
    const c = loadSemanticReferenceCases().find((x) => x.id === 'SEM-014')!;
    const r = evaluateReferenceCase(c);
    assert.equal(r.actual.supportLevel, 'SUPPORTED');
    assert.equal(r.actual.semanticLeap, 'NONE');
  });

  it('overlay flags only — does not invent fabricated when refs known', () => {
    const flags = collectOverlayFlags({
      claimText: '최근 7일 신규 사용자가 0명이다.',
      evidence: buildStubEvidencePack({ aggregates: { newUsersLast7d: 0 } }),
      evidenceRefs: ['aggregates.newUsersLast7d'],
      judgeReason: 'direct',
      leapType: 'NONE',
    });
    assert.ok(!flags.includes('FABRICATED_EVIDENCE_REF'));
    assert.ok(!flags.includes('MISSING_EVIDENCE_REF'));
  });

  it('overlay flags unknown-as-negative without rewriting', () => {
    const flags = collectOverlayFlags({
      claimText: '최근 7일 활성 사용자가 적다.',
      evidence: buildStubEvidencePack({ aggregates: { activeUsersLast7d: null } }),
      evidenceRefs: ['aggregates.activeUsersLast7d'],
      judgeReason: 'ok',
      leapType: 'NONE',
    });
    assert.ok(flags.includes('UNKNOWN_AS_NEGATIVE'));
  });

  it('chairman buckets for probe subset', () => {
    assert.equal(
      classifyChairmanBucket('SUPPORTED', 'NONE', 'DIRECT_FACT'),
      'CONFIRMED_FACT',
    );
    assert.equal(
      classifyChairmanBucket('NOT_SUPPORTED', 'FACT_TO_CAUSALITY', 'HYPOTHESIS'),
      'SEMANTIC_RISK',
    );
    assert.equal(
      classifyChairmanBucket('NOT_SUPPORTED', 'UNKNOWN_AS_NEGATIVE_EVIDENCE', 'INFERENCE'),
      'SEMANTIC_RISK',
    );
  });

  it('revision influence metrics count mismatch and ignore', () => {
    const m = measureRevisionInfluence({
      judgments: [
        {
          memberId: 'A',
          claimId: 'C1',
          semanticLeap: { detected: true, type: 'FACT_TO_CAUSALITY' },
          recommendedAction: 'NARROW',
          judgeClassification: { overclaimRisk: 'HIGH' },
        },
        {
          memberId: 'B',
          claimId: 'C2',
          semanticLeap: { detected: true, type: 'FACT_TO_TREND' },
          recommendedAction: 'REWORD',
          judgeClassification: { overclaimRisk: 'HIGH' },
        },
      ],
      revisions: [
        {
          memberId: 'A',
          revisionStatus: 'UNCHANGED',
          retainReason: '',
          revisionReason: null,
          confidenceBefore: 0.9,
          confidenceAfter: 0.9,
          changedClaims: [],
        },
        {
          memberId: 'B',
          revisionStatus: 'PARTIAL',
          retainReason: null,
          revisionReason: 'narrowed trend claim',
          confidenceBefore: 0.9,
          confidenceAfter: 0.7,
          changedClaims: ['C2'],
        },
      ],
      mismatchClaimKeys: ['A/C1'],
    });
    assert.equal(m.judgeIgnoredRisk, 1);
    assert.equal(m.judgeTriggeredRevision, 1);
    assert.equal(m.judgeTriggeredReword, 1);
    assert.equal(m.judgeTriggeredConfidenceChange, 1);
    assert.equal(m.judgeRevisionMismatch, 1);
  });

  it('full reference suite meets v9 success floor on leap recalls', () => {
    const { metrics, results } = runSemanticReferenceEvaluation();
    const fails = results.filter((r) => !r.match.semanticLeap || !r.match.support);
    assert.equal(
      fails.length,
      0,
      `mismatches: ${fails.map((f) => `${f.id}:${f.actual.semanticLeap}/${f.actual.supportLevel}`).join(', ')}`,
    );
    assert.equal(metrics.unknownNegativeRecall, 1);
    assert.equal(metrics.causalLeapRecall, 1);
    assert.equal(metrics.trendLeapRecall, 1);
    assert.equal(metrics.globalConclusionRecall, 1);
    assert.equal(metrics.techQualityRecall, 1);
    assert.ok(metrics.classificationAccuracy >= 0.9);
  });
});
