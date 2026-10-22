import type { Role } from '@prisma/client';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { hasSupabaseAuthCookie } from '@/lib/auth-cookie';
import { createClient } from '@/lib/supabase/server';
import type { InitialSession } from '@/components/SessionProvider';

/** (root) 레이아웃 전용 — 루트 HTML은 막지 않고 세션만 이쪽에서 조회 */
export async function getInitialSession(): Promise<InitialSession> {
  try {
    const cookieStore = await cookies();
    if (!hasSupabaseAuthCookie(cookieStore.getAll())) {
      return null;
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    let dbUsername: string | null = null;
    let dbRole: Role | null = null;
    try {
      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { username: true, role: true },
      });
      dbUsername = row?.username ?? null;
      dbRole = row?.role ?? null;
    } catch {
      /* DB 일시 오류 시 메타/이메일로 표시 */
    }

    return {
      userId: user.id,
      email: user.email ?? null,
      usernameFromMetadata: (user.user_metadata?.username as string | undefined) ?? null,
      dbUsername,
      dbRole,
    };
  } catch {
    return null;
  }
}
