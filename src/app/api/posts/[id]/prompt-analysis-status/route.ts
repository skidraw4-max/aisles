import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveRecipePrompt } from '@/lib/recipe-prompt';
import { fingerprintPrompt } from '@/lib/prompt-analysis-fingerprint';
import { parseStoredPromptAnalysisJson } from '@/lib/prompt-analysis';
import type { PromptAnalysis } from '@/lib/prompt-analysis';

type Ctx = { params: Promise<{ id: string }> };

/**
 * LAB 상세: 자동 분석 진행 여부 폴링용 (DB만 조회, Gemini 호출 없음)
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  const post = await prisma.post.findUnique({
    where: { id },
    select: {
      category: true,
      content: true,
      metadata: {
        select: {
          prompt: true,
          promptAnalysis: true,
          promptAnalysisPromptHash: true,
          promptAnalysisStatus: true,
        },
      },
    },
  });

  if (!post || post.category !== 'RECIPE') {
    return NextResponse.json({
      promptAnalysisStatus: null,
      analysis: null as PromptAnalysis | null,
    });
  }

  const promptText = resolveRecipePrompt(post);
  const fp = promptText.trim() ? fingerprintPrompt(promptText.trim()) : '';
  const meta = post.metadata;
  const hashMatch = Boolean(fp && meta?.promptAnalysisPromptHash === fp);
  const analysis: PromptAnalysis | null =
    hashMatch && meta?.promptAnalysis != null
      ? parseStoredPromptAnalysisJson(meta.promptAnalysis)
      : null;

  return NextResponse.json({
    promptAnalysisStatus: meta?.promptAnalysisStatus ?? null,
    analysis,
  });
}
