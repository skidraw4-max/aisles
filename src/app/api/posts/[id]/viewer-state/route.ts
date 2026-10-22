import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withDbRetry } from '@/lib/db-retry';
import { getUserFromBearer } from '@/lib/auth-bearer';
import {
  EMPTY_POST_VIEWER_STATE,
  type PostViewerState,
} from '@/lib/post-viewer-state.shared';

type Ctx = { params: Promise<{ id: string }> };

/** 로그인 시 좋아요·북마크·프로필 — ISR 게시글 셸과 분리 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id: postId } = await ctx.params;
  if (!postId?.trim()) {
    return NextResponse.json({ error: 'Missing post id' }, { status: 400 });
  }

  const auth = await getUserFromBearer(req);
  if (!auth.ok) {
    return NextResponse.json(EMPTY_POST_VIEWER_STATE satisfies PostViewerState);
  }

  const userId = auth.user.id;

  try {
    const [likedRow, bookmarkRow, meProfile] = await withDbRetry(() =>
      Promise.all([
        prisma.postLike.findUnique({
          where: { postId_userId: { postId, userId } },
          select: { postId: true },
        }),
        prisma.bookmark.findUnique({
          where: { userId_postId: { postId, userId } },
          select: { postId: true },
        }),
        prisma.user.findUnique({
          where: { id: userId },
          select: { username: true, avatarUrl: true, newsletterSubscribed: true, mbti: true },
        }),
      ])
    );

    const state: PostViewerState = {
      userId,
      liked: Boolean(likedRow),
      bookmarked: Boolean(bookmarkRow),
      username: meProfile?.username ?? null,
      avatarUrl: meProfile?.avatarUrl ?? null,
      newsletterSubscribed: meProfile?.newsletterSubscribed ?? false,
      mbti: meProfile?.mbti ?? null,
    };
    return NextResponse.json(state);
  } catch {
    return NextResponse.json({
      ...EMPTY_POST_VIEWER_STATE,
      userId,
    } satisfies PostViewerState);
  }
}
