/**
 * MIT News (RSS AI 토픽) → Gemini 요약 → LOUNGE(AI 트렌드) 자동 등록 (Vercel Cron 또는 수동)
 */
import { NextRequest, NextResponse } from 'next/server';
import { runMitNewsSync } from '@/lib/mit-news/run-mit-news-sync';

/** RSS 본문 부족 시 원문 fetch·Gemini 간격 합산 시 60초 초과 가능 */
export const maxDuration = 120;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/mit-news] CRON_SECRET unset — refusing to run');
    return false;
  }
  const auth = req.headers.get('authorization')?.trim();
  return auth === `Bearer ${secret}`;
}

function httpStatusForFailure(step: string): number {
  switch (step) {
    case 'mit_rss_fetch':
      return 502;
    case 'mit_rss_parse':
      return 422;
    default:
      return 500;
  }
}

function isTransientFailureStep(step: string): boolean {
  return step === 'mit_rss_fetch' || step === 'mit_rss_parse';
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
    console.log('[mit-news] 강제 실행 모드(force=true)');
  }

  let result: Awaited<ReturnType<typeof runMitNewsSync>>;
  try {
    result = await runMitNewsSync({ force });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[cron/mit-news] handle 예외', e);
    return NextResponse.json({
      ok: true,
      degraded: true,
      step: 'mit_rss_fetch',
      error: `UNHANDLED:${msg}`,
      message: `MIT News 크론 처리 중 예외: ${msg}`,
      created: 0,
      scanned: 0,
      force,
      results: [],
    });
  }

  if (!result.ok) {
    if (isTransientFailureStep(result.step)) {
      console.warn('[cron/mit-news] transient_failure', {
        step: 'handle_transient_failure',
        failureStep: result.step,
        error: result.error,
      });
      return NextResponse.json({
        ok: true,
        degraded: true,
        step: result.step,
        error: result.error,
        message: result.message,
        created: 0,
        scanned: 0,
        force,
        results: [],
      });
    }

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
