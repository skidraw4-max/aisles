/**
 * AI FORTUNE 주간 운세 — Gemini 생성 → AI_FORTUNE 복도 게시
 *
 * - 인증: `Authorization: Bearer ${CRON_SECRET}`
 * - 스케줄: 매주 월요일 05:00 KST (GitHub Actions `ai-fortune-weekly-kst.yml`)
 * - 배포 직후: `?bootstrap=true` 로 이번 주 글 즉시 1회 발행 (이후 동일 주차는 스킵)
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAiFortuneSync } from '@/lib/ai-fortune/run-ai-fortune-sync';

export const maxDuration = 120;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/ai-fortune] CRON_SECRET unset — refusing to run');
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
  const bootstrap = req.nextUrl.searchParams.get('bootstrap') === 'true';

  const result = await runAiFortuneSync({ force, bootstrap });

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
    status: result.status,
    weekKey: result.weekKey,
    postId: result.postId,
    force: result.force,
    bootstrap: result.bootstrap,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
