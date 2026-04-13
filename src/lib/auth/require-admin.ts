import type { Role } from '@prisma/client';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';

export type AdminAuthFailure = {
  ok: false;
  error: string;
  code: 'UNAUTHORIZED' | 'FORBIDDEN';
};

export type AdminAuthSuccess = { ok: true; userId: string };

/**
 * 공지 등 관리자 전용 서버 액션 최상단에서 호출.
 * Supabase 세션 + Prisma `User.role === ADMIN` 일 때만 통과.
 */
export async function requireAdminAction(): Promise<AdminAuthSuccess | AdminAuthFailure> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return { ok: false, error: '로그인이 필요합니다.', code: 'UNAUTHORIZED' };
  }

  let role: Role | null = null;
  try {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true },
    });
    role = row?.role ?? null;
  } catch (e) {
    console.error('[requireAdminAction] prisma', e);
    return { ok: false, error: '권한 확인에 실패했습니다.', code: 'FORBIDDEN' };
  }

  if (role !== 'ADMIN') {
    return { ok: false, error: '관리자만 실행할 수 있습니다.', code: 'FORBIDDEN' };
  }

  return { ok: true, userId: user.id };
}

/** 서버 컴포넌트에서 UI 분기용 (버튼 노출 여부 등) */
export async function getViewerIsAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return false;
  try {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true },
    });
    return row?.role === 'ADMIN';
  } catch {
    return false;
  }
}
