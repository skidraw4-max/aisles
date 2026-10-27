/**
 * READ_ONLY_ACCOUNT 자격증명 만료 파기 (I-043).
 * - 환경: `CRON_SECRET` (Bearer). 스위치 `READONLY_ACCOUNT_RETENTION_JOB_ENABLED`(코드 상수, 기본 off).
 * - vercel.json crons 에는 아직 등록하지 않음 (마이그레이션 적용 후 별도 승인).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createPrismaRetentionStore, READONLY_ACCOUNT_RETENTION_JOB_ENABLED } from '@/lib/jury-product/services/readonly-account/retention';
import { ownershipFlags } from '@/lib/jury-product/services/phase1-flags';
import { handleReadonlyAccountPurge } from '@/lib/jury-product/services/readonly-account/retention-route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** I-074: weekly ownership recheck shares this authorized daily run; skipped unless the ownership flag is on. */
async function recheckOwnershipIfEnabled(): Promise<object | null> {
  if (!ownershipFlags().ui) return null;
  try {
    const { recheckDueOwnerships, createPrismaOwnershipStore } = await import('@/lib/jury-product/services/ownership/service');
    return await recheckDueOwnerships({ store: await createPrismaOwnershipStore(), pepper: process.env.JURY_OWNERSHIP_TOKEN_PEPPER ?? null, now: new Date() });
  } catch {
    return { error: true };
  }
}

async function handle(req: NextRequest) {
  const res = await handleReadonlyAccountPurge(req.headers.get('authorization'), {
    secret: process.env.CRON_SECRET,
    enabled: READONLY_ACCOUNT_RETENTION_JOB_ENABLED,
    loadStore: createPrismaRetentionStore,
    now: () => new Date(),
  });
  // I-060: expired masked screenshots share the same authorized daily run.
  if (res.status === 200) {
    try {
      const [{ purgeExpiredScreenshots, createPrismaScreenshotRetentionStore }, { createSupabaseScreenshotSink }] = await Promise.all([
        import('@/lib/jury-product/services/screen-audit/screenshot-retention'),
        import('@/lib/jury-product/services/screen-audit/screenshot-store'),
      ]);
      const screenshots = await purgeExpiredScreenshots(await createPrismaScreenshotRetentionStore(), await createSupabaseScreenshotSink(), new Date());
      const ownership = await recheckOwnershipIfEnabled();
      return NextResponse.json({ ...(res.body as object), screenshots, ...(ownership ? { ownership } : {}) }, { status: res.status });
    } catch {
      return NextResponse.json({ ...(res.body as object), screenshots: { error: true } }, { status: res.status });
    }
  }
  return NextResponse.json(res.body, { status: res.status });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
