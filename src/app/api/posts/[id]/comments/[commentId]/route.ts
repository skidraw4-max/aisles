import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserFromBearer } from '@/lib/auth-bearer';

type Ctx = { params: Promise<{ id: string; commentId: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await getUserFromBearer(req);
  if (!auth.ok) return auth.response;

  const { id: postId, commentId } = await ctx.params;

  const comment = await prisma.comment.findFirst({
    where: { id: commentId, postId },
    select: { id: true, authorId: true },
  });
  if (!comment) {
    return NextResponse.json({ error: '댓글을 찾을 수 없습니다.' }, { status: 404 });
  }
  if (comment.authorId !== auth.user.id) {
    return NextResponse.json({ error: '삭제 권한이 없습니다.' }, { status: 403 });
  }

  await prisma.comment.delete({ where: { id: commentId } });
  return NextResponse.json({ ok: true });
}
