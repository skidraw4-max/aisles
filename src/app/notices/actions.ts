'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAdminAction } from '@/lib/auth/require-admin';
import { isPrismaNoticeTableMissing } from '@/lib/prisma-notice';

/** 롤링 바: 제목만 쓰고 클릭 시 `/notices/[id]` 로 이동 */
export type RollingNoticeDTO = {
  id: string;
  title: string;
};

export type NoticeAdminResult<T = unknown> =
  | { ok: true; data?: T }
  | {
      ok: false;
      error: string;
      code?: 'UNAUTHORIZED' | 'FORBIDDEN' | 'VALIDATION' | 'NOT_FOUND';
    };

/**
 * 상단 롤링 바용: isRolling === true 만, 우선순위 내림차순 → 등록 최신순.
 */
export async function getRollingNoticesForBar(): Promise<RollingNoticeDTO[]> {
  try {
    return await prisma.notice.findMany({
      where: { isRolling: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, title: true },
    });
  } catch (e) {
    if (isPrismaNoticeTableMissing(e)) {
      return [];
    }
    console.error('[getRollingNoticesForBar]', e);
    return [];
  }
}

function revalidateNoticeViews(noticeId?: string) {
  revalidatePath('/');
  revalidatePath('/notices');
  revalidatePath('/notices/admin');
  if (noticeId) {
    revalidatePath(`/notices/${noticeId}`);
  }
}

export async function createNoticeAdminAction(input: {
  title: string;
  content: string;
  link?: string | null;
  isRolling: boolean;
  priority: number;
}): Promise<NoticeAdminResult<{ id: string }>> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return { ok: false, error: auth.error, code: auth.code };
  }

  const title = input.title?.trim();
  if (!title) {
    return { ok: false, error: '제목을 입력해 주세요.', code: 'VALIDATION' };
  }

  const content = input.content?.trim() ?? '';
  if (!content) {
    return { ok: false, error: '본문을 입력해 주세요.', code: 'VALIDATION' };
  }

  const linkRaw = input.link?.trim();
  const priority = Number.isFinite(input.priority) ? Math.trunc(input.priority) : 0;

  const row = await prisma.notice.create({
    data: {
      title,
      content,
      link: linkRaw ? linkRaw : null,
      isRolling: Boolean(input.isRolling),
      priority,
    },
    select: { id: true },
  });

  revalidateNoticeViews(row.id);
  return { ok: true, data: { id: row.id } };
}

export async function updateNoticeAdminAction(input: {
  id: string;
  title: string;
  content: string;
  link?: string | null;
  isRolling: boolean;
  priority: number;
}): Promise<NoticeAdminResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return { ok: false, error: auth.error, code: auth.code };
  }

  const title = input.title?.trim();
  if (!title) {
    return { ok: false, error: '제목을 입력해 주세요.', code: 'VALIDATION' };
  }

  const content = input.content?.trim() ?? '';
  if (!content) {
    return { ok: false, error: '본문을 입력해 주세요.', code: 'VALIDATION' };
  }

  const linkRaw = input.link?.trim();
  const priority = Number.isFinite(input.priority) ? Math.trunc(input.priority) : 0;

  try {
    await prisma.notice.update({
      where: { id: input.id },
      data: {
        title,
        content,
        link: linkRaw ? linkRaw : null,
        isRolling: Boolean(input.isRolling),
        priority,
      },
    });
  } catch {
    return { ok: false, error: '해당 공지를 찾을 수 없습니다.', code: 'NOT_FOUND' };
  }

  revalidateNoticeViews(input.id);
  return { ok: true };
}

export async function deleteNoticeAdminAction(id: string): Promise<NoticeAdminResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return { ok: false, error: auth.error, code: auth.code };
  }

  try {
    await prisma.notice.delete({ where: { id } });
  } catch {
    return { ok: false, error: '해당 공지를 찾을 수 없습니다.', code: 'NOT_FOUND' };
  }

  revalidatePath('/');
  revalidatePath('/notices');
  revalidatePath('/notices/admin');
  revalidatePath(`/notices/${id}`);
  return { ok: true };
}
