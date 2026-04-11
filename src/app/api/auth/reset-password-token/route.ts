import { prisma } from '@/lib/prisma';
import { createAdminClient, hasServiceRoleKey } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

const MIN_LEN = 6;

/**
 * 토큰으로 검증한 뒤 Supabase Auth 비밀번호 변경 (service role).
 */
export async function POST(request: Request) {
  if (!hasServiceRoleKey()) {
    return NextResponse.json({ error: '서버에 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const o = body as { token?: unknown; password?: unknown };
  const token = typeof o.token === 'string' ? o.token.trim() : '';
  const password = typeof o.password === 'string' ? o.password : '';

  if (!token || password.length < MIN_LEN) {
    return NextResponse.json({ error: '유효하지 않은 요청입니다.' }, { status: 400 });
  }

  const row = await prisma.passwordResetToken.findUnique({
    where: { token },
  });

  if (!row || row.usedAt || row.expiresAt <= new Date()) {
    return NextResponse.json({ error: '유효하지 않거나 만료된 링크입니다.' }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(row.userId, { password });
    if (error) {
      console.error('[reset-password-token]', error.message);
      return NextResponse.json({ error: '비밀번호 변경에 실패했습니다.' }, { status: 500 });
    }

    await prisma.passwordResetToken.update({
      where: { token },
      data: { usedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[reset-password-token]', e);
    return NextResponse.json({ error: '비밀번호 변경에 실패했습니다.' }, { status: 500 });
  }
}
