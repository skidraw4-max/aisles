/**
 * Run: node --import tsx --test src/lib/ai-review-board/revision-quality.test.ts
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
  listRevisionIntegrityIssues,
  majorityAloneCannotRaiseConfidence,
  normalizeRevisionRecord,
  textUsesMajorityAsGround,
} from './revision-quality';
import { revisionStatusImpliesChange } from './types';

describe('revision quality helpers', () => {
  it('detects majority/herding phrases as invalid ground', () => {
    assert.equal(textUsesMajorityAsGround('All reviewers agree with me'), true);
    assert.equal(textUsesMajorityAsGround('The majority agrees'), true);
    assert.equal(textUsesMajorityAsGround('Consensus supports my opinion'), true);
    assert.equal(textUsesMajorityAsGround('Other reviewers confirmed my view'), true);
    assert.equal(textUsesMajorityAsGround('다른 리뷰어들이 동의한다'), true);
    assert.equal(
      textUsesMajorityAsGround(
        'activeUsersLast7d is null so platform-wide crisis cannot be proven from newUsers alone',
      ),
      false,
    );
  });

  it('does not allow majority alone to raise confidence', () => {
    assert.equal(
      majorityAloneCannotRaiseConfidence(0.8, 0.95, 'All reviewers agree'),
      false,
    );
    assert.equal(
      majorityAloneCannotRaiseConfidence(0.8, 0.95, 'New metric postsLast7d directly supports claim'),
      true,
    );
    assert.equal(majorityAloneCannotRaiseConfidence(0.9, 0.7, 'All reviewers agree'), true);
  });

  it('UNCHANGED requires retainReason; revised false', () => {
    const r = normalizeRevisionRecord({
      memberId: 'A',
      originalOpinion: 'LOUNGE share is high per postsByCategory',
      confidenceBefore: 0.8,
      revisionStatus: 'UNCHANGED',
      retainReason:
        'Strongest rebuttal was weak (inference about UX). postsByCategory directly supports LOUNGE share claim; gap on activeUsers does not overturn that scoped claim.',
      confidenceAfter: 0.8,
      revisionAnswers: {
        q1_coreClaim: 'LOUNGE share high',
        q2_strongestRebuttal: 'Maybe UX is cause',
        q3_rebuttalEvidenceKind: 'inference',
        q4_evidenceGapsFound: 'activeUsersLast7d null',
        q5_gapAffectsCoreClaim: 'No — core claim is category share',
        q6_directlySupportedScope: 'postsByCategory LOUNGE dominance',
        q7_overclaimCheck: 'Did not claim platform crisis',
        q8_whyRetainIfUnchanged: 'Scoped metric claim stands',
        q9_claimsToChangeIfPartial: '',
        q10_groundsForFullRevision: 'None',
        q11_chosenStatus: 'UNCHANGED',
        q12_confidenceChange: 'unchanged',
      },
    });
    assert.equal(r.revisionStatus, 'UNCHANGED');
    assert.equal(r.revised, false);
    assert.ok(r.retainReason && r.retainReason.length > 20);
    assert.equal(r.revisionReason, null);
    assert.deepEqual(r.changedClaims, []);
    assert.ok(r.revisionAnswers.q1_coreClaim);
    assert.equal(listRevisionIntegrityIssues(r).includes('missing_retainReason'), false);
  });

  it('PARTIAL requires changedClaims and revisionReason', () => {
    const r = normalizeRevisionRecord({
      memberId: 'B',
      originalOpinion: 'Platform has a severe engagement crisis',
      confidenceBefore: 0.95,
      revisionStatus: 'PARTIAL',
      revisionReason: 'Softened crisis claim due to null activeUsers/views',
      changedClaims: [
        'Replace platform-wide engagement crisis with: last-7d new users and comments are zero; overall engagement unknown',
      ],
      confidenceAfter: 0.7,
      confidenceChangeReason: 'Evidence gap on activeUsersLast7d and viewsLast7d weakens crisis claim',
      finalOpinion:
        'Last-7d signups and comments are zero, but activeUsers/views null so platform-wide crisis is not proven',
      revisionAnswers: {
        q1_coreClaim: 'engagement crisis',
        q2_strongestRebuttal: 'null active/views',
        q3_rebuttalEvidenceKind: 'direct_evidence (null metrics)',
        q4_evidenceGapsFound: 'activeUsersLast7d, viewsLast7d',
        q5_gapAffectsCoreClaim: 'Yes',
        q6_directlySupportedScope: 'newUsersLast7d=0, commentsLast7d=0',
        q7_overclaimCheck: 'crisis overclaim',
        q8_whyRetainIfUnchanged: '',
        q9_claimsToChangeIfPartial: 'crisis → scoped low signup/comments',
        q10_groundsForFullRevision: 'No — direction still low activity signals',
        q11_chosenStatus: 'PARTIAL',
        q12_confidenceChange: '0.95→0.7',
      },
    });
    assert.equal(r.revisionStatus, 'PARTIAL');
    assert.equal(r.revised, true);
    assert.ok(r.changedClaims.length >= 1);
    assert.ok(r.revisionReason);
    assert.equal(r.retainReason, null);
    assert.ok(r.confidenceAfter < r.confidenceBefore);
  });

  it('FULL marks revised true and allows core claim change', () => {
    const r = normalizeRevisionRecord({
      memberId: 'C',
      originalOpinion: 'Growth is healthy',
      confidenceBefore: 0.7,
      revisionStatus: 'FULL',
      revisionReason: 'Direct metrics show zero new users and zero comments last 7d',
      changedClaims: ['Growth healthy → acquisition/comment activity stalled last 7d'],
      confidenceAfter: 0.75,
      confidenceChangeReason: 'Direct metrics contradict prior growth claim',
      finalOpinion: 'Acquisition and comments stalled last 7d',
    });
    assert.equal(r.revisionStatus, 'FULL');
    assert.equal(revisionStatusImpliesChange(r.revisionStatus), true);
    assert.equal(r.revised, true);
    assert.ok(r.changedClaims[0]?.includes('Growth'));
  });

  it('blocks confidence increase when reason is majority-only', () => {
    const r = normalizeRevisionRecord({
      memberId: 'D',
      originalOpinion: 'x',
      confidenceBefore: 0.8,
      revisionStatus: 'UNCHANGED',
      retainReason: 'Metric newUsersLast7d=0 still supports scoped acquisition concern after reviewing rebuttal about UX.',
      confidenceAfter: 0.99,
      confidenceChangeReason: 'All reviewers agree',
    });
    assert.equal(r.confidenceAfter, r.confidenceBefore);
    assert.equal(
      majorityAloneCannotRaiseConfidence(0.8, 0.99, 'All reviewers agree'),
      false,
    );
  });

  it('flags majority-as-retain-ground in integrity issues', () => {
    const r = normalizeRevisionRecord({
      memberId: 'E',
      originalOpinion: 'x',
      confidenceBefore: 0.9,
      revisionStatus: 'UNCHANGED',
      retainReason: 'The majority agrees so I keep my view',
      confidenceAfter: 0.9,
    });
    const issues = listRevisionIntegrityIssues(r);
    assert.ok(issues.includes('majority_as_retain_ground'));
  });

  it('allows evidence-gap driven PARTIAL without forcing it', () => {
    const r = normalizeRevisionRecord({
      memberId: 'A',
      originalOpinion: 'severe engagement crisis',
      confidenceBefore: 0.95,
      revisionStatus: 'PARTIAL',
      revisionReason: 'Gap activeUsersLast7d/viewsLast7d → soften crisis language',
      changedClaims: ['crisis → unproven platform-wide; keep zero signup/comments facts'],
      confidenceAfter: 0.65,
      confidenceChangeReason: 'evidence gap affects core claim strength',
    });
    assert.equal(r.revisionStatus, 'PARTIAL');
    assert.ok(!listRevisionIntegrityIssues(r).includes('partial_without_changedClaims'));
  });
});

describe('mock pipeline revision phase', () => {
  it('runs independent → debate → revision → critic → chairman (17 calls)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arb-v4-'));
    const evidence = buildStubEvidencePack();
    const llm = createMockReviewBoardLlm({ revisionStatus: 'PARTIAL' });
    const run = await runReviewBoardPipeline({
      rootDir: root,
      llm,
      evidence,
      maxCalls: 40,
      runId: 'run-v4-test',
    });
    assert.equal(run.status, 'completed');
    assert.equal(run.debate.length, 5);
    assert.equal(run.revisions?.length, 5);
    assert.equal(run.budget.usedCalls, EXPECTED_PIPELINE_LLM_CALLS);
    for (const rev of run.revisions!) {
      assert.ok(rev.revisionAnswers.q1_coreClaim !== undefined);
      assert.equal(rev.revised, revisionStatusImpliesChange(rev.revisionStatus));
      if (rev.revisionStatus === 'UNCHANGED') {
        assert.ok(rev.retainReason);
      }
      if (rev.revisionStatus === 'PARTIAL') {
        assert.ok(rev.changedClaims.length >= 1);
      }
    }
    const loaded = await loadRun(root, 'run-v4-test');
    assert.equal(loaded!.revisions?.length, 5);
    await fs.access(path.join(root, 'run-v4-test', 'revisions.json'));
  });

  it('UNCHANGED mock path keeps retainReason without forcing change', async () => {
    const llm = createMockReviewBoardLlm({ reviseOnDebate: false, revisionStatus: 'UNCHANGED' });
    const evidence = buildStubEvidencePack();
    const own = await llm.independentAnalysis('A', evidence, {
      phase: 'independent',
      memberId: 'A',
      evidence,
    });
    const debate = await llm.debateTurn('A', evidence, [own], own);
    assert.equal(debate.revisionStatus, undefined);
    const rev = await llm.revisionPass!('A', evidence, own, debate, [own]);
    assert.equal(rev.revisionStatus, 'UNCHANGED');
    assert.equal(rev.revised, false);
    assert.ok(rev.retainReason && !textUsesMajorityAsGround(rev.retainReason));
  });

  it('does not mutate preserved baseline run ids when loading fixtures', async () => {
    const root = path.join(process.cwd(), 'data', 'ai-review-board');
    for (const id of [
      'run-2026-09-17T07-53-24-323Z',
      'run-2026-09-17T09-27-13-078Z',
      'run-2026-09-17T10-09-59-178Z',
    ]) {
      const before = await fs.readFile(path.join(root, id, 'run.json'), 'utf8');
      const run = await loadRun(root, id);
      assert.ok(run);
      assert.ok(!run.revisions || run.revisions.length === 0 || Array.isArray(run.revisions));
      const after = await fs.readFile(path.join(root, id, 'run.json'), 'utf8');
      assert.equal(before, after);
    }
  });
});
