/**
 * Run: node --import tsx --test src/lib/ai-review-board/*.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { SCORE_DIMENSIONS } from './score-dimensions';
import {
  listScoresLackingHardEvidence,
  normalizeDimensionScore,
  weightedOverallScore,
} from './scoring';
import {
  IndependenceViolationError,
  assertDebateReady,
  assertIndependentContext,
  stripPeersForIndependent,
} from './independence';
import { buildStubEvidencePack } from './evidence-pack';
import { createMockReviewBoardLlm } from './mock-llm';
import { runReviewBoardPipeline } from './orchestrator';
import { loadRun, listRuns } from './store';
import { COMMITTEE_ANALYSTS } from './types';
import type { EvidencePack, IndependentAnalysis, LlmContext } from './types';

describe('score dimensions', () => {
  it('keeps SEO and GEO as separate dimensions', () => {
    assert.ok(SCORE_DIMENSIONS.includes('seo'));
    assert.ok(SCORE_DIMENSIONS.includes('geo'));
    assert.notEqual(
      SCORE_DIMENSIONS.indexOf('seo'),
      SCORE_DIMENSIONS.indexOf('geo'),
    );
  });
});

describe('scoring / evidence separation', () => {
  it('nulls scores that lack hard evidence', () => {
    const normalized = normalizeDimensionScore({
      dimension: 'seo',
      score: 88,
      evidence: [{ kind: 'inference', text: 'I feel SEO is good' }],
    });
    assert.equal(normalized.score, null);
  });

  it('keeps scores with observation evidence', () => {
    const normalized = normalizeDimensionScore({
      dimension: 'geo',
      score: 70,
      evidence: [{ kind: 'doc', text: 'docs/geo-optimization.md exists', source: 'docs' }],
    });
    assert.equal(normalized.score, 70);
  });

  it('rescales 1-5 model scores to 0-100', () => {
    const normalized = normalizeDimensionScore({
      dimension: 'community',
      score: 2,
      evidence: [{ kind: 'metric', text: 'usersLast7d: 0', source: 'aggregates' }],
    });
    assert.equal(normalized.score, 40);
  });

  it('lists dimensions lacking hard evidence', () => {
    const lacking = listScoresLackingHardEvidence([
      { dimension: 'seo', score: 50, evidence: [] },
      {
        dimension: 'geo',
        score: 50,
        evidence: [{ kind: 'metric', text: 'indexed pages', source: 'stub' }],
      },
    ]);
    assert.deepEqual(lacking, ['seo']);
  });

  it('does not use simple unweighted average for overall', () => {
    const overall = weightedOverallScore([
      {
        confidence: 0.9,
        scores: [
          {
            dimension: 'seo',
            score: 100,
            evidence: [{ kind: 'metric', text: 'a', source: 'x' }],
          },
        ],
      },
      {
        confidence: 0.2,
        scores: [
          {
            dimension: 'seo',
            score: 0,
            evidence: [{ kind: 'observation', text: 'b' }],
          },
        ],
      },
    ]);
    assert.ok(overall !== null);
    assert.ok(overall! > 50);
  });
});

describe('independence', () => {
  it('rejects peer analyses in independent phase', () => {
    const evidence = buildStubEvidencePack();
    const peer = {
      memberId: 'B',
      currentState: 'x',
      strengths: [],
      problems: [],
      trendGap: '',
      improvementNeed: '',
      improvements: [],
      scores: [],
      judgmentBasis: '',
      confidence: 0.5,
      originalOpinion: 'peer',
    } satisfies IndependentAnalysis;
    const ctx: LlmContext = {
      phase: 'independent',
      memberId: 'A',
      evidence,
      peerAnalyses: [peer],
    };
    assert.throws(() => assertIndependentContext(ctx), IndependenceViolationError);
  });

  it('stripPeersForIndependent removes peers', () => {
    const evidence = buildStubEvidencePack();
    const stripped = stripPeersForIndependent({
      phase: 'independent',
      memberId: 'A',
      evidence,
      peerAnalyses: [
        {
          memberId: 'B',
          currentState: '',
          strengths: [],
          problems: [],
          trendGap: '',
          improvementNeed: '',
          improvements: [],
          scores: [],
          judgmentBasis: '',
          confidence: 0.5,
          originalOpinion: 'x',
        },
      ],
    });
    assert.equal(stripped.peerAnalyses, undefined);
    assertIndependentContext(stripped);
  });

  it('blocks debate until all independent analyses exist', () => {
    assert.throws(() => assertDebateReady([], COMMITTEE_ANALYSTS));
  });
});

describe('orchestrator pipeline (mock llm)', () => {
  it('runs independent → debate → revision → critic → chairman and persists runId files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arb-'));
    const evidence = buildStubEvidencePack({
      aggregates: {
        userCount: 10,
        usersLast7d: 2,
        postCount: 100,
        postsLast7d: 5,
        totalViews: 1000,
        commentCount: 20,
        postsByCategory: { LOUNGE: 40, RECIPE: 30 },
      },
    });
    const llm = createMockReviewBoardLlm({ reviseOnDebate: true });
    const run = await runReviewBoardPipeline({
      rootDir: root,
      llm,
      evidence,
      maxCalls: 40,
      runId: 'run-test-1',
    });

    assert.equal(run.status, 'completed');
    assert.equal(run.independent.length, 5);
    assert.equal(run.debate.length, 5);
    assert.equal(run.revisions?.length, 5);
    assert.equal(run.budget.usedCalls, 17);
    assert.ok(run.critic);
    assert.ok(run.final);

    for (const a of run.independent) {
      assert.ok(a.originalOpinion.length > 0);
    }
    for (const r of run.revisions!) {
      if (r.revised) {
        assert.ok(r.revisionReason);
        assert.ok(r.changedClaims.length >= 1);
      } else {
        assert.ok(r.retainReason);
      }
    }

    const loaded = await loadRun(root, 'run-test-1');
    assert.ok(loaded);
    assert.equal(loaded!.runId, 'run-test-1');
    assert.equal(loaded!.independent.length, 5);
    assert.equal(loaded!.revisions?.length, 5);

    const dir = path.join(root, 'run-test-1');
    for (const f of [
      'evidence.json',
      'independent-analysis.json',
      'debate.json',
      'revisions.json',
      'critic.json',
      'final.json',
      'run.json',
      'raw-log.jsonl',
    ]) {
      await fs.access(path.join(dir, f));
    }

    const ids = await listRuns(root);
    assert.ok(ids.includes('run-test-1'));
  });

  it('does not start debate before independent completes (assertDebateReady)', () => {
    const partial: IndependentAnalysis[] = [
      {
        memberId: 'A',
        currentState: '',
        strengths: [],
        problems: [],
        trendGap: '',
        improvementNeed: '',
        improvements: [],
        scores: [],
        judgmentBasis: '',
        confidence: 0.5,
        originalOpinion: 'only A',
      },
    ];
    assert.throws(() => assertDebateReady(partial, COMMITTEE_ANALYSTS));
  });

  it('mock independent refuses peer leakage via assert', async () => {
    const llm = createMockReviewBoardLlm();
    const evidence = buildStubEvidencePack();
    await assert.rejects(
      () =>
        llm.independentAnalysis('A', evidence, {
          phase: 'independent',
          memberId: 'A',
          evidence,
          peerAnalyses: [
            {
              memberId: 'B',
              currentState: '',
              strengths: [],
              problems: [],
              trendGap: '',
              improvementNeed: '',
              improvements: [],
              scores: [],
              judgmentBasis: '',
              confidence: 0.5,
              originalOpinion: 'leak',
            },
          ],
        }),
      IndependenceViolationError,
    );
  });
});

describe('evidence pack read-only contract', () => {
  it('marks pack as readOnly and piiExcluded', () => {
    const pack: EvidencePack = buildStubEvidencePack();
    assert.equal(pack.readOnly, true);
    assert.equal(pack.piiExcluded, true);
  });
});

describe('enrichFinalReport', () => {
  it('fills overall and dimensions from independent when chairman leaves nulls', async () => {
    const { enrichFinalReport } = await import('./finalize-report');
    const independent: IndependentAnalysis[] = [
      {
        memberId: 'A',
        currentState: '',
        strengths: [],
        problems: [],
        trendGap: '',
        improvementNeed: '',
        improvements: [],
        scores: [
          {
            dimension: 'seo',
            score: 80,
            evidence: [{ kind: 'metric', text: 'pages', source: 'x' }],
          },
        ],
        judgmentBasis: '',
        confidence: 0.9,
        originalOpinion: 'a',
      },
    ];
    const enriched = enrichFinalReport(
      {
        statusSummary: 's',
        overallTrendScore: null,
        dimensionScores: [],
        topProblems: [],
        improvements: [],
        expectedUserEffect: '',
        expectedDifficulty: '',
        risk: '',
        improvementEvidence: [],
        opinionDifferences: [],
        confidence: 0.8,
        needsFurtherVerification: [],
      },
      independent,
      null,
    );
    assert.ok(enriched.overallTrendScore !== null);
    const seo = enriched.dimensionScores.find((d) => d.dimension === 'seo');
    assert.equal(seo?.score, 80);
  });
});
