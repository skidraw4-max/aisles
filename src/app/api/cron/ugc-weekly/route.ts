/**
 * BUILD/LAUNCH 주간 베스트 위클리 글 자동 발행
 * - 인증: Authorization: Bearer ${CRON_SECRET}
 * - 스케줄: GitHub Actions `ugc-weekly-digest-kst.yml` (매주 월요일 06:00 KST)
 */
import { NextRequest, NextResponse } from 'next/server';
import { runUgcWeeklyDigestSync } from '@/lib/ugc-weekly/run-ugc-weekly-digest';

export const maxDuration = 60;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/ugc-weekly] CRON_SECRET unset — refusing to run');
    return false;
  }
  const auth = req.headers.get('authorization')?.trim();
  return auth === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json(
      {
        ok: false,
        step: 'auth',
        error: 'UNAUTHORIZED',
        message: 'CRON_SECRET이 없거나 Authorization: Bearer 가 일치하지 않습니다.',
      },
      { status: 401 }
    );
  }

  const weekKey = req.nextUrl.searchParams.get('weekKey')?.trim() || undefined;
  const result = await runUgcWeeklyDigestSync({ weekKey });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
