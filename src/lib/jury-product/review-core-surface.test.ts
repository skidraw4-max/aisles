/**
 * Phase 3: display-only committee copy in review-core.ts. DB-free, no board run, no LLM call.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { DebateTurn, FinalReport, IndependentAnalysis } from '../ai-review-board/types';
import { committeeSurfaceFromRun, MEMBER_OPINION_LIMITS, memberOpinionsFromRun, normalizeConfidence, surfaceFromFinal } from './review-core';
import { committeeView } from './review-console';

function analysis(memberId: IndependentAnalysis['memberId'], extra: Partial<IndependentAnalysis> = {}): IndependentAnalysis {
  return {
    memberId,
    currentState: 'state',
    strengths: [],
    problems: ['p1', 'p2', 'p3', 'p4'],
    trendGap: '',
    improvementNeed: '',
    improvements: [],
    scores: [],
    judgmentBasis: `basis ${memberId}`,
    confidence: 0.7,
    originalOpinion: `original ${memberId}`,
    ...extra,
  };
}

function final(extra: Partial<FinalReport> = {}): FinalReport {
  return {
    statusSummary: 'summary',
    overallTrendScore: null,
    dimensionScores: [],
    topProblems: ['top'],
    improvements: [],
    expectedUserEffect: 'effect',
    expectedDifficulty: '',
    risk: 'risk',
    improvementEvidence: [],
    opinionDifferences: ['A and F disagree'],
    confidence: 0.64,
    needsFurtherVerification: [],
    disputedPoints: ['point'],
    ...extra,
  } as FinalReport;
}

test('member opinions copy only display fields, prefer the debate final opinion, and keep A..E order', () => {
  const debate: DebateTurn[] = [
    { memberId: 'B', agreement: [], disagreement: [], weakEvidence: [], missed: [], needsVerification: [], finalOpinion: 'final B', confidence: 80, revised: true },
  ];
  const rows = memberOpinionsFromRun({ independent: [analysis('C'), analysis('A'), analysis('B')], debate });
  assert.deepEqual(rows.map((row) => row.memberId), ['A', 'B', 'C']);
  assert.equal(rows[0].opinion, 'original A');
  assert.equal(rows[1].opinion, 'final B');
  assert.equal(rows[1].confidence, 0.8);
  assert.equal(rows[1].revised, true);
  assert.equal(rows[0].revised, null);
  assert.equal(rows[0].problems.length, MEMBER_OPINION_LIMITS.problems);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['basis', 'confidence', 'memberId', 'opinion', 'problems', 'revised']);
});

test('long text is clipped to the agreed limits', () => {
  const rows = memberOpinionsFromRun({
    independent: [analysis('A', { originalOpinion: 'x'.repeat(2000), judgmentBasis: 'y'.repeat(2000), problems: ['z'.repeat(900)] })],
    debate: [],
  });
  assert.equal(rows[0].opinion.length, MEMBER_OPINION_LIMITS.opinion);
  assert.equal(rows[0].opinion.endsWith('…'), true);
  assert.equal(rows[0].basis.length, MEMBER_OPINION_LIMITS.basis);
  assert.equal(rows[0].problems[0].length, MEMBER_OPINION_LIMITS.item);
  const committee = committeeSurfaceFromRun(final({ opinionDifferences: Array.from({ length: 9 }, (_, i) => `d${i}`) }), { independent: [], debate: [] });
  assert.equal(committee.opinionDifferences?.length, MEMBER_OPINION_LIMITS.listItems);
});

test('confidence accepts 0..1 or 0..100 only', () => {
  assert.equal(normalizeConfidence(0.5), 0.5);
  assert.equal(normalizeConfidence(64), 0.64);
  assert.equal(normalizeConfidence(-1), null);
  assert.equal(normalizeConfidence(500), null);
  assert.equal(normalizeConfidence('0.5'), null);
  assert.equal(normalizeConfidence(Number.NaN), null);
});

test('secret-looking committee text is dropped as a whole', () => {
  const committee = committeeSurfaceFromRun(final(), { independent: [analysis('A', { originalOpinion: 'use access_token abc' })], debate: [] });
  assert.equal(committee.memberOpinionsOmitted, 'SECRET');
  assert.deepEqual(committee.memberOpinions, []);
  assert.deepEqual(committee.opinionDifferences, []);
});

test('surfaceFromFinal keeps the original eight fields unchanged and adds optional committee fields', () => {
  const surface = surfaceFromFinal(final(), { independent: [analysis('A')], debate: [] });
  assert.equal(surface.statusSummary, 'summary');
  assert.deepEqual(surface.topProblems, ['top']);
  assert.equal(surface.boardConfidence, 0.64);
  assert.equal(surface.memberOpinions?.length, 1);
  assert.equal(surface.memberOpinionsOmitted, null);
  const empty = surfaceFromFinal(null);
  assert.deepEqual(empty.memberOpinions, []);
  assert.equal(empty.boardConfidence, null);
});

test('console view falls back to evidence strength for older results and marks them as legacy', () => {
  const legacy = committeeView({
    statusSummary: '', topProblems: [], expectedUserEffect: '', risk: '', dimensionEvidence: [],
    supportedClaims: [], partiallySupportedClaims: [], hypotheses: [],
  }, 'moderate');
  assert.equal(legacy.memberOpinions, null);
  assert.deepEqual(legacy.confidence, { value: null, source: 'EVIDENCE_STRENGTH', evidenceStrength: 'moderate' });
  const fresh = committeeView({ ...surfaceFromFinal(final(), { independent: [analysis('A')], debate: [] }) }, 'strong');
  assert.equal(fresh.confidence?.source, 'BOARD');
  assert.equal(fresh.memberOpinions?.length, 1);
});

test('review-core stays a read-only caller of the frozen pipeline', () => {
  const source = readFileSync(new URL('./review-core.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('credentialRef'), false);
  assert.equal(source.includes('data/ai-review-board'), false);
  assert.equal(source.includes('expectedDecision: actual.expectedDecision'), true);
  assert.equal(/run\.(independent|debate|final)\s*=/.test(source), false);
  assert.equal(source.includes('prisma'), false);
});
