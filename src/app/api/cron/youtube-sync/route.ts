/**
 * MIT OpenCourseWare / Google DeepMind YouTube → 자막·Gemini 요약 → 게시 (Vercel Cron 또는 수동)
 */
import { NextRequest, NextResponse } from 'next/server';
import { runYoutubeSync } from '@/lib/youtube-sync/run-youtube-sync';

export const maxDuration = 120;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/youtube-sync] CRON_SECRET unset — refusing to run');
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
      { status: 401 },
    );
  }

  const force = req.nextUrl.searchParams.get('force') === 'true';
  const result = await runYoutubeSync({ force });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        step: result.step,
        error: result.error,
        message: result.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    created: result.created,
    force: result.force,
    results: result.results,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
