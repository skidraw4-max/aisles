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
 * DB/토큰 테이블 오류 시에도 Supabase 메일 발송은 시도(토큰 없이 redirectTo 만 사용).
 */
export async function POST(request: Request) {
  try {
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

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
      return NextResponse.json({ error: '서버 설정 오류입니다.' }, { status: 503 });
    }

    let redirectTo = getPasswordRecoveryRedirectToForServer();

    let prismaUser: { id: string; email: string } | null = null;
    try {
      prismaUser = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, email: true },
      });
    } catch (dbErr) {
      console.error('[api/auth/forgot-password] prisma user lookup failed:', dbErr);
    }

    if (prismaUser) {
      try {
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
      } catch (tokenErr) {
        console.error(
          '[api/auth/forgot-password] PasswordResetToken 저장 실패(마이그레이션·DB 확인). reset-callback URL로 메일만 발송합니다:',
          tokenErr,
        );
      }
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      console.error('[api/auth/forgot-password]', { redirectTo, message: error.message });
      return NextResponse.json(
        {
          error:
            error.message ||
            '비밀번호 찾기 메일을 보내지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.',
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/auth/forgot-password] unexpected:', e);
    return NextResponse.json(
      { error: '일시적으로 요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}
