import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserFromBearer } from '@/lib/auth-bearer';
import { ensurePrismaUser } from '@/lib/ensure-user';

type Ctx = { params: Promise<{ id: string }> };

/**
 * 로그인한 사용자만: PostLike 행 생성/삭제와 Post.likeCount 증감을 트랜잭션으로 동기화합니다.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await getUserFromBearer(req);
  if (!auth.ok) return auth.response;

  const { id: postId } = await ctx.params;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true },
  });
  if (!post) {
    return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 });
  }

  await ensurePrismaUser(auth.user);

  const userId = auth.user.id;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.postLike.findUnique({
        where: { postId_userId: { postId, userId } },
      });

      if (existing) {
        await tx.postLike.delete({
          where: { postId_userId: { postId, userId } },
        });
        const updated = await tx.post.update({
          where: { id: postId },
          data: { likeCount: { decrement: 1 } },
          select: { likeCount: true },
        });
        const likeCount = Math.max(0, updated.likeCount);
        if (likeCount !== updated.likeCount) {
          await tx.post.update({ where: { id: postId }, data: { likeCount } });
        }
        return { liked: false, likeCount };
      }

      await tx.postLike.create({
        data: { postId, userId },
      });
      const updated = await tx.post.update({
        where: { id: postId },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });
      return { liked: true, likeCount: updated.likeCount };
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '좋아요 처리에 실패했습니다.' }, { status: 500 });
  }
}
