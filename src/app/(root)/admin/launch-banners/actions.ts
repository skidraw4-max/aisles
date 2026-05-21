'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAdminAction } from '@/lib/auth/require-admin';

export type LaunchBannerAdminResult =
  | { ok: true }
  | { ok: false; error: string; code?: 'UNAUTHORIZED' | 'FORBIDDEN' | 'VALIDATION' | 'NOT_FOUND' };

function revalidateLaunchViews() {
  revalidatePath('/');
  revalidatePath('/admin/launch-banners');
}

export async function setLaunchBannerAdminAction(input: {
  postId: string;
  featuredOnHome: boolean;
  launchBannerUntil?: string | null;
}): Promise<LaunchBannerAdminResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return { ok: false, error: auth.error, code: auth.code };
  }

  const post = await prisma.post.findUnique({
    where: { id: input.postId },
    select: { id: true, category: true },
  });
  if (!post) {
    return { ok: false, error: '게시글을 찾을 수 없습니다.', code: 'NOT_FOUND' };
  }
  if (post.category !== 'LAUNCH') {
    return { ok: false, error: 'LAUNCH 복도 글만 배너 설정할 수 있습니다.', code: 'VALIDATION' };
  }

  let until: Date | null = null;
  if (input.launchBannerUntil?.trim()) {
    const parsed = new Date(input.launchBannerUntil.trim());
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: '만료일 형식이 올바르지 않습니다.', code: 'VALIDATION' };
    }
    until = parsed;
  }

  await prisma.post.update({
    where: { id: input.postId },
    data: {
      featuredOnHome: Boolean(input.featuredOnHome),
      launchBannerUntil: input.featuredOnHome ? until : null,
    },
  });

  revalidateLaunchViews();
  return { ok: true };
}

export async function unfeatureLaunchBannerAdminAction(postId: string): Promise<LaunchBannerAdminResult> {
  return setLaunchBannerAdminAction({ postId, featuredOnHome: false, launchBannerUntil: null });
}
