/**
 * AI Breakfast (Beehiiv) → Gemini 요약 → LOUNGE 자동 등록 (Vercel Cron 또는 수동)
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAiBreakfastSync } from '@/lib/aibreakfast/run-aibreakfast-sync';

export const maxDuration = 60;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/aibreakfast] CRON_SECRET unset — refusing to run');
    return false;
  }
  const auth = req.headers.get('authorization')?.trim();
  return auth === `Bearer ${secret}`;
}

function httpStatusForFailure(step: string): number {
  switch (step) {
    case 'aibreakfast_home_fetch':
    case 'aibreakfast_post_fetch':
      return 502;
    case 'aibreakfast_parse':
      return 422;
    default:
      return 500;
  }
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
  if (force) {
    console.log('[aibreakfast] 강제 실행 모드(force=true)');
  }

  const result = await runAiBreakfastSync({ force });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        step: result.step,
        error: result.error,
        message: result.message,
      },
      { status: httpStatusForFailure(result.step) },
    );
  }

  return NextResponse.json({
    ok: true,
    created: result.created,
    scanned: result.scanned,
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
