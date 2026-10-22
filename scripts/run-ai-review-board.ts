/**
 * AI 운영위원회 1차 — 로컬 CLI 전용 (Admin 서버 실행 없음)
 *
 *   npx tsx scripts/run-ai-review-board.ts
 *   npx tsx scripts/run-ai-review-board.ts --stub-evidence
 *   npx tsx scripts/run-ai-review-board.ts --mock-llm
 *   npx tsx scripts/run-ai-review-board.ts --mock-ga
 *   npx tsx scripts/run-ai-review-board.ts --with-ga
 *
 * Env: GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY
 *      AI_REVIEW_BOARD_MAX_CALLS_PER_RUN (default 40)
 *      DATABASE_URL (EvidencePack DB 집계; --stub-evidence 시 불필요)
 *      GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT_JSON(_BASE64) or GOOGLE_APPLICATION_CREDENTIALS
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: '.env.local' });
loadEnv();

async function main() {
  const args = new Set(process.argv.slice(2));
  const stubEvidence = args.has('--stub-evidence');
  const mockLlm = args.has('--mock-llm');
  const mockGa = args.has('--mock-ga');
  const withGa = args.has('--with-ga');

  const {
    DEFAULT_REVIEW_BOARD_ROOT,
    attachGa4Evidence,
    buildEvidencePackFromDb,
    buildMockGa4Evidence,
    buildStubEvidencePack,
    createGeminiReviewBoardLlm,
    createMockReviewBoardLlm,
    runReviewBoardPipeline,
  } = await import('../src/lib/ai-review-board');

  console.log('[ai-review-board] starting', {
    stubEvidence,
    mockLlm,
    mockGa,
    withGa,
    expectedLlmCalls: 32,
    maxCalls: Number(process.env.AI_REVIEW_BOARD_MAX_CALLS_PER_RUN || 40),
  });

  let evidence;
  if (stubEvidence) {
    evidence = buildStubEvidencePack({
      aggregates: {
        userCount: 0,
        usersLast7d: 0,
        newUsersLast7d: 0,
        activeUsersLast7d: null,
        postCount: 0,
        postsLast7d: 0,
        commentsLast7d: 0,
        viewsLast7d: null,
        totalViews: 0,
        commentCount: 0,
        postsByCategory: {},
      },
    });
  } else {
    const { prisma } = await import('../src/lib/prisma');
    evidence = await buildEvidencePackFromDb(prisma);
    await prisma.$disconnect();
  }

  if (mockGa) {
    evidence = await attachGa4Evidence(evidence, {
      mockGa4: buildMockGa4Evidence({
        propertyId: process.env.GA4_PROPERTY_ID?.trim() || 'mock',
        users: {
          totalUsers: null,
          activeUsers: 120,
          newUsers: 35,
          returningUsers: null,
        },
        metrics: {
          activeUsers: 120,
          sessions: 200,
          screenPageViews: 800,
          engagedSessions: 90,
          averageSessionDurationSec: 42,
          eventCountByName: { comment_submit: 2, stance_vote: 1 },
        },
      }),
    });
  } else {
    evidence = await attachGa4Evidence(evidence);
  }

  if (withGa && evidence.ga4?.available !== true) {
    console.error('[ai-review-board] --with-ga required GA4 available=true but got', {
      available: evidence.ga4?.available ?? false,
      errorCode: evidence.ga4?.errorCode ?? null,
      error: evidence.ga4?.error ?? null,
    });
    process.exit(1);
  }

  console.log('[ai-review-board] ga4', {
    available: evidence.ga4?.available ?? false,
    errorCode: evidence.ga4?.errorCode ?? null,
    error: evidence.ga4?.error ?? null,
    period: evidence.ga4?.period ?? null,
    activeUsers: evidence.ga4?.metrics.activeUsers ?? null,
    evidenceItemCount: evidence.evidenceItems?.length ?? 0,
  });

  const llm = mockLlm ? createMockReviewBoardLlm() : createGeminiReviewBoardLlm();
  const rootDir = path.resolve(DEFAULT_REVIEW_BOARD_ROOT);

  const run = await runReviewBoardPipeline({
    rootDir,
    llm,
    evidence,
  });

  console.log('[ai-review-board] completed', {
    runId: run.runId,
    status: run.status,
    budget: run.budget,
    overallTrendScore: run.final?.overallTrendScore ?? null,
    confidence: run.final?.confidence ?? null,
    dir: path.join(rootDir, run.runId),
  });
}

main().catch((e) => {
  console.error('[ai-review-board] failed', e);
  process.exit(1);
});
