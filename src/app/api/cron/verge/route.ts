/**
 * The Verge RSS → 요약 → LOUNGE(AI 트렌드) 자동 등록 (Vercel Cron)
 *
 * - 환경: `CRON_SECRET`(필수), `GOOGLE_GENERATIVE_AI_API_KEY` 또는 `GEMINI_API_KEY`, 작성자는 GeekNews·Hacker News와 동일 (`HACKERNEWS_AUTHOR_USERNAME` → `GEEKNEWS_AUTHOR_USERNAME` → 기본 `Nedai`)
 * - RSS URL: `VERGE_RSS_URL` (`run-verge-sync.ts`) — The Verge AI RSS
 * - 프로덕션 일괄 실행은 `/api/cron/daily-news-bundled`(Verge→GeekNews→HN) 권장
 * - `GET` 또는 `POST` 동일 동작. `?force=true` 시 중복 URL 스킵 없이 시도(삽입 시 DB 유니크로 막힘).
 */
import { NextRequest, NextResponse } from 'next/server';
import { runVergeSync } from '@/lib/verge/run-verge-sync';

export const maxDuration = 300;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/verge] CRON_SECRET unset — refusing to run');
    return false;
  }
  const auth = req.headers.get('authorization')?.trim();
  return auth === `Bearer ${secret}`;
}

function httpStatusForFailure(step: string): number {
  switch (step) {
    case 'verge_rss_fetch':
      return 502;
    case 'verge_rss_parse':
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
    console.log('[verge] 강제 실행 모드(force=true) — 중복 URL 스킵 없음');
  }

  const result = await runVergeSync({ force });

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
