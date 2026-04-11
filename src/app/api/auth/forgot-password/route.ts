import { randomBytes } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import {
  buildPasswordRecoveryPageUrlWithToken,
  getPasswordRecoveryRedirectToForServer,
} from '@/lib/site-url';
import { NextResponse } from 'next/server';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * 비밀번호 찾기: 브라우저 대신 서버에서 `resetPasswordForEmail` 호출.
 * Prisma에 등록된 유저는 `redirectTo`에 `/reset-password?token=...` 포함.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const email =
    typeof body === 'object' && body !== null && 'email' in body && typeof (body as { email: unknown }).email === 'string'
      ? (body as { email: string }).email.trim()
      : '';

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: '유효한 이메일을 입력해 주세요.' }, { status: 400 });
  }

  const emailLower = email.toLowerCase();
  const prismaUser = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });

  let redirectTo = getPasswordRecoveryRedirectToForServer();

  if (prismaUser) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    await prisma.passwordResetToken.create({
      data: {
        token,
        email: prismaUser.email,
        userId: prismaUser.id,
        expiresAt,
      },
    });
    redirectTo = buildPasswordRecoveryPageUrlWithToken(token);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    console.error('[api/auth/forgot-password]', { redirectTo, message: error.message });
  }

  return NextResponse.json({ ok: true });
}
