import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveRecipePrompt } from '@/lib/recipe-prompt';

type Ctx = { params: Promise<{ id: string }> };

/** Lab 글의 실제 프롬프트 텍스트 (복사 버튼용) */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  const post = await prisma.post.findUnique({
    where: { id },
    select: {
      id: true,
      category: true,
      content: true,
      metadata: { select: { prompt: true } },
    },
  });

  if (!post) {
    return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 });
  }

  const prompt = post.category === 'RECIPE' ? resolveRecipePrompt(post) : '';

  return NextResponse.json({ prompt });
}
