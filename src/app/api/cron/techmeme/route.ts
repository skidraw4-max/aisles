/**
 * Techmeme 공식 RSS (`https://www.techmeme.com/feed.xml`) → 요약 → LOUNGE 자동 등록
 *
 * - `CRON_SECRET`, Gemini 키, 작성자는 HN·GeekNews·Lobsters와 동일 (`HACKERNEWS_AUTHOR_USERNAME` → `GEEKNEWS_AUTHOR_USERNAME` → Nedai)
 * - `GET`/`POST` 동일. `?force=true` 시 중복 URL 스킵 없이 시도
 */
import { NextRequest, NextResponse } from 'next/server';
import { runTechmemeSync } from '@/lib/techmeme/run-techmeme-sync';

export const maxDuration = 120;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/techmeme] CRON_SECRET unset — refusing to run');
    return false;
  }
  const auth = req.headers.get('authorization')?.trim();
  return auth === `Bearer ${secret}`;
}

function httpStatusForFailure(step: string): number {
  switch (step) {
    case 'techmeme_rss_fetch':
      return 502;
    case 'techmeme_rss_parse':
    case 'techmeme_candidates':
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
    console.log('[techmeme] 강제 실행 모드(force=true)');
  }

  const result = await runTechmemeSync({ force });

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
