import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

/**
 * 비밀번호 재설정 링크의 `?token=` 유효성 (존재·미사용·만료 전).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ valid: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const token =
    typeof body === 'object' && body !== null && 'token' in body && typeof (body as { token: unknown }).token === 'string'
      ? (body as { token: string }).token.trim()
      : '';

  if (!token) {
    return NextResponse.json({ valid: false });
  }

  const row = await prisma.passwordResetToken.findUnique({
    where: { token },
  });

  const valid = !!(row && !row.usedAt && row.expiresAt > new Date());
  return NextResponse.json({ valid });
}
