/**
 * Run: node --import tsx --test src/lib/ai-review-board/claim-calibration.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildStubEvidencePack } from './evidence-pack';
import { createMockReviewBoardLlm } from './mock-llm';
import { runReviewBoardPipeline } from './orchestrator';
import { loadRun } from './store';
import {
  EXPECTED_PIPELINE_LLM_CALLS,
  calibrationSuggestsSoftening,
  countSupportLevels,
  formatCalibrationForRevisionPrompt,
  isCausalClaimWithoutEvidence,
  listClaimFlags,
  normalizeClaimCalibration,
  usesUnknownAsNegativeEvidence,
} from './claim-calibration';
import type { CalibratedClaim, ClaimCalibration } from './types';

function claim(partial: Partial<CalibratedClaim> & Pick<CalibratedClaim, 'claimText'>): CalibratedClaim {
  return {
    claimId: partial.claimId ?? 'C001',
    claimText: partial.claimText,
    evidenceRefs: partial.evidenceRefs ?? [],
    evidenceType: partial.evidenceType ?? 'INFERENCE',
    supportLevel: partial.supportLevel ?? 'PARTIALLY_SUPPORTED',
    reason: partial.reason ?? '',
    missingEvidence: partial.missingEvidence ?? [],
    evidenceImpact: partial.evidenceImpact ?? 'LOW',
    riskOfOverclaiming: partial.riskOfOverclaiming ?? 'LOW',
  };
}

describe('claim calibration helpers', () => {
  it('DIRECT_FACT + SUPPORTED for newUsersLast7d=0', () => {
    const c = claim({
      claimText: '최근 7일 신규 사용자 유입이 없다.',
      evidenceRefs: ['newUsersLast7d'],
      evidenceType: 'DIRECT_FACT',
      supportLevel: 'SUPPORTED',
      reason: 'newUsersLast7d is 0.',
      evidenceImpact: 'NONE',
    });
    assert.equal(c.supportLevel, 'SUPPORTED');
    assert.equal(c.evidenceType, 'DIRECT_FACT');
    const evidence = buildStubEvidencePack();
    assert.equal(listClaimFlags(c, evidence).includes('unknown_as_evidence'), false);
  });

  it('UNKNOWN + NOT_SUPPORTED when claiming active users low from null', () => {
    const c = claim({
      claimText: '활성 사용자가 거의 없다.',
      evidenceRefs: ['activeUsersLast7d'],
      evidenceType: 'UNKNOWN',
      supportLevel: 'NOT_SUPPORTED',
      reason: 'activeUsersLast7d is null so users are low',
      evidenceImpact: 'HIGH',
      riskOfOverclaiming: 'HIGH',
    });
    assert.equal(
      usesUnknownAsNegativeEvidence(c.claimText, c.evidenceType, c.evidenceRefs, c.reason),
      true,
    );
    const flags = listClaimFlags(c, buildStubEvidencePack());
    assert.ok(flags.includes('unknown_as_evidence'));
  });

  it('INFERENCE + PARTIALLY_SUPPORTED for platform-wide engagement', () => {
    const c = claim({
      claimText: 'AIsle의 전체 사용자 참여도가 심각하게 낮다.',
      evidenceRefs: ['newUsersLast7d', 'commentsLast7d', 'activeUsersLast7d', 'viewsLast7d'],
      evidenceType: 'INFERENCE',
      supportLevel: 'PARTIALLY_SUPPORTED',
      reason: 'Zero signup/comments but active/views null',
      missingEvidence: ['activeUsersLast7d', 'viewsLast7d'],
      evidenceImpact: 'HIGH',
      riskOfOverclaiming: 'HIGH',
    });
    assert.equal(c.supportLevel, 'PARTIALLY_SUPPORTED');
    assert.equal(c.evidenceImpact, 'HIGH');
  });

  it('HYPOTHESIS + NOT_SUPPORTED for Gemini boosts engagement', () => {
    const c = claim({
      claimText: 'Gemini AI 기능이 사용자 참여를 증가시키고 있다.',
      evidenceRefs: [],
      evidenceType: 'HYPOTHESIS',
      supportLevel: 'NOT_SUPPORTED',
      reason: 'No engagement lift metric',
      evidenceImpact: 'MEDIUM',
    });
    assert.equal(c.supportLevel, 'NOT_SUPPORTED');
  });

  it('evidence gap HIGH on core engagement claim vs NONE on signup fact', () => {
    const core = claim({
      claimText: '플랫폼 전체 engagement가 심각하게 낮다.',
      evidenceImpact: 'HIGH',
      missingEvidence: ['activeUsersLast7d', 'viewsLast7d'],
      supportLevel: 'PARTIALLY_SUPPORTED',
      evidenceType: 'INFERENCE',
    });
    const fact = claim({
      claimId: 'C002',
      claimText: '최근 신규 가입자는 0명이다.',
      evidenceRefs: ['newUsersLast7d'],
      evidenceType: 'DIRECT_FACT',
      supportLevel: 'SUPPORTED',
      evidenceImpact: 'NONE',
      missingEvidence: ['activeUsersLast7d'],
    });
    assert.equal(core.evidenceImpact, 'HIGH');
    assert.equal(fact.evidenceImpact, 'NONE');
  });

  it('flags causal claim without evidence', () => {
    assert.equal(
      isCausalClaimWithoutEvidence(
        'UX/UI 문제 때문에 신규 사용자가 유입되지 않는다.',
        'HYPOTHESIS',
        [],
        'NOT_SUPPORTED',
      ),
      true,
    );
  });

  it('detects overclaiming risk on crisis language with partial support', () => {
    const c = claim({
      claimText: 'platform-wide engagement crisis',
      supportLevel: 'PARTIALLY_SUPPORTED',
      evidenceType: 'INFERENCE',
      riskOfOverclaiming: 'HIGH',
      missingEvidence: ['activeUsersLast7d'],
    });
    const flags = listClaimFlags(c, buildStubEvidencePack());
    assert.ok(flags.includes('overclaim_risk'));
  });

  it('calibrationSuggestsSoftening when HIGH impact partial claims exist', () => {
    const cal: ClaimCalibration = {
      memberId: 'A',
      claims: [
        claim({
          claimText: 'severe engagement crisis',
          supportLevel: 'PARTIALLY_SUPPORTED',
          evidenceImpact: 'HIGH',
          evidenceType: 'INFERENCE',
        }),
      ],
    };
    assert.equal(calibrationSuggestsSoftening(cal), true);
    assert.ok(formatCalibrationForRevisionPrompt(cal).includes('PARTIALLY_SUPPORTED'));
  });

  it('SUPPORTED-only calibration does not suggest softening', () => {
    const cal: ClaimCalibration = {
      memberId: 'B',
      claims: [
        claim({
          claimText: 'newUsersLast7d is 0',
          evidenceRefs: ['newUsersLast7d'],
          evidenceType: 'DIRECT_FACT',
          supportLevel: 'SUPPORTED',
          evidenceImpact: 'NONE',
        }),
      ],
    };
    assert.equal(calibrationSuggestsSoftening(cal), false);
    assert.deepEqual(countSupportLevels(cal), {
      SUPPORTED: 1,
      PARTIALLY_SUPPORTED: 0,
      NOT_SUPPORTED: 0,
    });
  });

  it('normalizeClaimCalibration fills defaults', () => {
    const cal = normalizeClaimCalibration('C', {
      claims: [{ claimText: 'x', evidenceType: 'DIRECT_FACT', supportLevel: 'SUPPORTED' }],
    });
    assert.equal(cal.memberId, 'C');
    assert.equal(cal.claims[0]!.claimId, 'C001');
  });
});

describe('claim calibration → revision wiring (mock)', () => {
  it('passes calibration into revisionPass and can yield PARTIAL without forcing', async () => {
    const llm = createMockReviewBoardLlm({
      revisionStatus: 'PARTIAL',
      claimCalibrationProfile: 'mixed-gaps',
    });
    const evidence = buildStubEvidencePack();
    const own = await llm.independentAnalysis('A', evidence, {
      phase: 'independent',
      memberId: 'A',
      evidence,
    });
    const debate = await llm.debateTurn('A', evidence, [own], own);
    const cal = await llm.claimCalibrate('A', evidence, own, debate);
    assert.ok(cal.claims.length >= 3);
    const levels = countSupportLevels(cal);
    assert.ok(levels.SUPPORTED >= 1);
    assert.ok(levels.PARTIALLY_SUPPORTED >= 1);

    const rev = await llm.revisionPass('A', evidence, own, debate, [own], cal);
    assert.equal(rev.revisionStatus, 'PARTIAL');
    assert.ok(rev.changedClaims.length >= 1);
    assert.ok(rev.confidenceAfter <= rev.confidenceBefore);
  });

  it('SUPPORTED path can stay UNCHANGED', async () => {
    const llm = createMockReviewBoardLlm({
      revisionStatus: 'UNCHANGED',
      claimCalibrationProfile: 'all-supported',
    });
    const evidence = buildStubEvidencePack();
    const own = await llm.independentAnalysis('B', evidence, {
      phase: 'independent',
      memberId: 'B',
      evidence,
    });
    const debate = await llm.debateTurn('B', evidence, [own], own);
    const cal = await llm.claimCalibrate('B', evidence, own, debate);
    assert.equal(calibrationSuggestsSoftening(cal), false);
    const rev = await llm.revisionPass('B', evidence, own, debate, [own], cal);
    assert.equal(rev.revisionStatus, 'UNCHANGED');
    assert.ok(rev.retainReason);
  });

  it('NOT_SUPPORTED core can yield FULL when mock requests it', async () => {
    const llm = createMockReviewBoardLlm({
      revisionStatus: 'FULL',
      claimCalibrationProfile: 'not-supported-core',
    });
    const evidence = buildStubEvidencePack();
    const own = await llm.independentAnalysis('C', evidence, {
      phase: 'independent',
      memberId: 'C',
      evidence,
    });
    const debate = await llm.debateTurn('C', evidence, [own], own);
    const cal = await llm.claimCalibrate('C', evidence, own, debate);
    assert.ok(cal.claims.some((c) => c.supportLevel === 'NOT_SUPPORTED'));
    const rev = await llm.revisionPass('C', evidence, own, debate, [own], cal);
    assert.equal(rev.revisionStatus, 'FULL');
  });

  it('majority phrases still cannot raise confidence', async () => {
    const { normalizeRevisionRecord } = await import('./revision-quality');
    const r = normalizeRevisionRecord({
      memberId: 'D',
      originalOpinion: 'x',
      confidenceBefore: 0.7,
      revisionStatus: 'UNCHANGED',
      retainReason: 'newUsersLast7d=0 still holds after reviewing weakest rebuttal',
      confidenceAfter: 0.95,
      confidenceChangeReason: 'All reviewers agree',
    });
    assert.equal(r.confidenceAfter, r.confidenceBefore);
  });

  it('pipeline runs 27 calls and persists claim-calibrations.json', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arb-v5-'));
    const evidence = buildStubEvidencePack();
    const llm = createMockReviewBoardLlm({
      revisionStatus: 'PARTIAL',
      claimCalibrationProfile: 'mixed-gaps',
    });
    const run = await runReviewBoardPipeline({
      rootDir: root,
      llm,
      evidence,
      maxCalls: 40,
      runId: 'run-v5-test',
    });
    assert.equal(run.status, 'completed');
    assert.equal(run.budget.usedCalls, EXPECTED_PIPELINE_LLM_CALLS);
    assert.equal(EXPECTED_PIPELINE_LLM_CALLS, 27);
    assert.equal(run.claimCalibrations?.length, 5);
    assert.equal(run.revisions?.length, 5);
    await fs.access(path.join(root, 'run-v5-test', 'claim-calibrations.json'));
    const loaded = await loadRun(root, 'run-v5-test');
    assert.equal(loaded!.claimCalibrations?.length, 5);
  });

  it('does not mutate v1–v4 baseline JSON', async () => {
    const root = path.join(process.cwd(), 'data', 'ai-review-board');
    for (const id of [
      'run-2026-09-17T07-53-24-323Z',
      'run-2026-09-17T09-27-13-078Z',
      'run-2026-09-17T10-09-59-178Z',
      'run-2026-09-17T10-34-21-451Z',
    ]) {
      const before = await fs.readFile(path.join(root, id, 'run.json'), 'utf8');
      const run = await loadRun(root, id);
      assert.ok(run);
      const after = await fs.readFile(path.join(root, id, 'run.json'), 'utf8');
      assert.equal(before, after);
    }
  });
});
