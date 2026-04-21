/**
 * The Verge → GeekNews → Hacker News → AI Breakfast → MIT News 순차 실행 (한 소스 실패 시 다음 소스 계속)
 *
 * - 환경: `CRON_SECRET`(필수)
 * - 스케줄: `vercel.json` — `0 20 * * *` (UTC) 근처 한국 새벽
 */
import { NextRequest, NextResponse } from 'next/server';
import { runDailyNewsSyncBundled } from '@/lib/cron/daily-news-sync';

export const maxDuration = 60;

function serializeThrown(e: unknown): { message?: string; name?: string; detail?: unknown } {
  if (e instanceof Error) {
    return { name: e.name, message: e.message };
  }
  return { detail: e };
}

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/daily-news-bundled] CRON_SECRET unset — refusing to run');
    return false;
  }
  const auth = req.headers.get('authorization')?.trim();
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
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
  const result = await runDailyNewsSyncBundled({ force });

  return NextResponse.json({
    ok: true,
    force,
    verge:
      'thrown' in result.verge
        ? { thrown: serializeThrown(result.verge.thrown) }
        : result.verge,
    geeknews:
      'thrown' in result.geeknews
        ? { thrown: serializeThrown(result.geeknews.thrown) }
        : result.geeknews,
    hackernews:
      'thrown' in result.hackernews
        ? { thrown: serializeThrown(result.hackernews.thrown) }
        : result.hackernews,
    aibreakfast:
      'thrown' in result.aibreakfast
        ? { thrown: serializeThrown(result.aibreakfast.thrown) }
        : result.aibreakfast,
    mitnews:
      'thrown' in result.mitnews ? { thrown: serializeThrown(result.mitnews.thrown) } : result.mitnews,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
