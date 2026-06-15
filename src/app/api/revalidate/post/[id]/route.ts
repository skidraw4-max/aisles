import { NextRequest, NextResponse } from 'next/server';
import { revalidatePostCaches } from '@/lib/post-revalidate';

type Ctx = { params: Promise<{ id: string }> };

/**
 * 온디맨드 ISR — `Authorization: Bearer ${CRON_SECRET}` 필요.
 * 크론·관리 작업 후 `/post/[id]` 캐시를 즉시 갱신할 때 사용합니다.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (auth !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing post id' }, { status: 400 });
  }

  revalidatePostCaches(id.trim());
  return NextResponse.json({ revalidated: true, postId: id.trim() });
}
