import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserFromBearer } from '@/lib/auth-bearer';
import { ensurePrismaUser } from '@/lib/ensure-user';

type Ctx = { params: Promise<{ id: string }> };

/**
 * 북마크 추가/해제 (토글). Post 카운터 필드는 없고 Bookmark 행만 조작합니다.
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
    const existing = await prisma.bookmark.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      await prisma.bookmark.delete({
        where: { userId_postId: { userId, postId } },
      });
      return NextResponse.json({ bookmarked: false });
    }

    await prisma.bookmark.create({
      data: { userId, postId },
    });
    return NextResponse.json({ bookmarked: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '북마크 처리에 실패했습니다.' }, { status: 500 });
  }
}
