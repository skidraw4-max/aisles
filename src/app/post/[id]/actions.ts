'use server';

import { prisma } from '@/lib/prisma';

/** 게시글 상세 접속 시 조회수 +1 */
export async function incrementPostViews(postId: string): Promise<number | null> {
  try {
    const row = await prisma.post.update({
      where: { id: postId },
      data: { views: { increment: 1 } },
      select: { views: true },
    });
    return row.views;
  } catch {
    return null;
  }
}
