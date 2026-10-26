/**
 * READ_ONLY_ACCOUNT 자격증명 만료 파기 (I-043).
 * - 환경: `CRON_SECRET` (Bearer). 스위치 `READONLY_ACCOUNT_RETENTION_JOB_ENABLED`(코드 상수, 기본 off).
 * - vercel.json crons 에는 아직 등록하지 않음 (마이그레이션 적용 후 별도 승인).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createPrismaRetentionStore, READONLY_ACCOUNT_RETENTION_JOB_ENABLED } from '@/lib/jury-product/services/readonly-account/retention';
import { handleReadonlyAccountPurge } from '@/lib/jury-product/services/readonly-account/retention-route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: NextRequest) {
  const res = await handleReadonlyAccountPurge(req.headers.get('authorization'), {
    secret: process.env.CRON_SECRET,
    enabled: READONLY_ACCOUNT_RETENTION_JOB_ENABLED,
    loadStore: createPrismaRetentionStore,
    now: () => new Date(),
  });
  return NextResponse.json(res.body, { status: res.status });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
