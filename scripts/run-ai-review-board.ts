/**
 * AI 운영위원회 1차 — 로컬 CLI 전용 (Admin 서버 실행 없음)
 *
 *   npx tsx scripts/run-ai-review-board.ts
 *   npx tsx scripts/run-ai-review-board.ts --stub-evidence
 *   npx tsx scripts/run-ai-review-board.ts --mock-llm
 *
 * Env: GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY
 *      AI_REVIEW_BOARD_MAX_CALLS_PER_RUN (default 40)
 *      DATABASE_URL (EvidencePack DB 집계; --stub-evidence 시 불필요)
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: '.env.local' });
loadEnv();

async function main() {
  const args = new Set(process.argv.slice(2));
  const stubEvidence = args.has('--stub-evidence');
  const mockLlm = args.has('--mock-llm');

  const {
    DEFAULT_REVIEW_BOARD_ROOT,
    buildEvidencePackFromDb,
    buildStubEvidencePack,
    createGeminiReviewBoardLlm,
    createMockReviewBoardLlm,
    runReviewBoardPipeline,
  } = await import('../src/lib/ai-review-board');

  console.log('[ai-review-board] starting', {
    stubEvidence,
    mockLlm,
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
