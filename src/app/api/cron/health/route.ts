import { NextResponse } from 'next/server';

/** GitHub Actions·운영자용 정적 헬스 — DB 없이 cron 라우트 가용성만 표시 */
const JOBS = [
  { id: 'ai-fortune', path: '/api/cron/ai-fortune', scheduleKst: '월 05:00' },
  { id: 'news-digest', path: '/api/cron/news-digest', scheduleKst: '매일 06:00·18:00' },
  { id: 'news-chain', path: '/api/cron/geeknews (체인)', scheduleKst: '3시간마다 UTC 정각' },
] as const;

export async function GET() {
  return NextResponse.json({
    ok: true,
    jobs: JOBS.map((j) => ({ ...j, lastRun: null })),
    note: 'lastRun은 DB 미연동 — GitHub Actions 실행 이력으로 확인',
  });
}
