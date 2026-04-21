/**
 * GeekNews → 요약 → LOUNGE 자동 등록 (Vercel Cron)
 *
 * - 환경: `CRON_SECRET`(필수), `GOOGLE_GENERATIVE_AI_API_KEY` 또는 `GEMINI_API_KEY`, Prisma `User.username` 기본 `Nedai` (`GEEKNEWS_AUTHOR_USERNAME`으로 변경 가능)
 * - 스케줄: `vercel.json` — `0 20 * * *` (UTC) ≈ 한국 시간 새벽 5시
 * - `GET` 또는 `POST` 동일 동작. `?force=true` 시 중복 URL 스킵 없이 시도(삽입 시 DB 유니크로 막힘).
 */
import { NextRequest, NextResponse } from 'next/server';
import { runGeekNewsSync } from '@/lib/geeknews/run-geeknews-sync';

export const maxDuration = 60;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/geeknews] CRON_SECRET unset — refusing to run');
    return false;
  }
  const auth = req.headers.get('authorization')?.trim();
  return auth === `Bearer ${secret}`;
}

function httpStatusForFailure(step: string): number {
  switch (step) {
    case 'geeknews_list_fetch':
      return 502;
    case 'geeknews_parse':
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
    console.log('[geeknews] 강제 실행 모드(force=true) — 중복 URL 스킵 없음');
  }

  const result = await runGeekNewsSync({ force });

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
