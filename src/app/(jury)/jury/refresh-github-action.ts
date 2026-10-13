'use server';

import { getJuryActor } from '@/lib/jury-product/session';
import { runGithubRefreshEntry } from '@/lib/jury-product/services/github/refresh-entry';
import { startGithubRefreshReview } from '@/lib/jury-product/services/github/refresh';
import { createPrismaRefreshStore } from '@/lib/jury-product/services/github/refresh-store';

export async function refreshGithubEvidence(input: { connectionId: string; evidenceId: string }) {
  const actor = await getJuryActor(null);
  return runGithubRefreshEntry({
    actor,
    connectionId: input.connectionId,
    evidenceId: input.evidenceId,
    loadConnection: async (query) => {
      const { prisma } = await import('@/lib/prisma');
      return prisma.juryServiceConnection.findFirst({
        where: { id: query.connectionId, tenantId: query.tenantId },
        select: { id: true, tenantId: true },
      });
    },
    loadScopeApproved: async (query) => {
      const { prisma } = await import('@/lib/prisma');
      const scope = await prisma.juryAccessScope.findFirst({
        where: { tenantId: query.tenantId, connectionId: query.connectionId, status: 'APPROVED' },
        select: { id: true },
      });
      return scope !== null;
    },
    loadEvidence: async (query) => {
      const { prisma } = await import('@/lib/prisma');
      return prisma.juryEvidence.findFirst({
        where: { id: query.evidenceId, tenantId: query.tenantId, connectionId: query.connectionId },
        select: { id: true, tenantId: true, connectionId: true },
      });
    },
    start: async (args) => startGithubRefreshReview({
      ...args,
      store: await createPrismaRefreshStore(),
      execute: async (pack) => {
        const { callFrozenReviewPipeline } = await import('@/lib/jury-product/review-core');
        const { createGeminiReviewBoardLlm } = await import('@/lib/ai-review-board');
        const { readGeminiApiKeyFromEnv } = await import('@/lib/gemini-prompt-analysis-engine');
        const { JURY_PRODUCT_DATA_ROOT } = await import('@/lib/jury-product/records');
        const key = readGeminiApiKeyFromEnv();
        if (!key.ok) throw new Error('REVIEW_NOT_EXECUTED');
        return callFrozenReviewPipeline({
          rootDir: JURY_PRODUCT_DATA_ROOT,
          evidence: pack,
          llm: createGeminiReviewBoardLlm(key.key),
        });
      },
    }),
  });
}
