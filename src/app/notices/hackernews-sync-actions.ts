'use server';

import { requireAdminAction } from '@/lib/auth/require-admin';
import { runHackerNewsSync, type HackerNewsSyncResult } from '@/lib/hackernews/run-hackernews-sync';

/** 관리자 전용 — 공지 관리 화면에서 Hacker News 동기화 트리거 */
export async function runHackerNewsSyncAdminAction(force: boolean): Promise<HackerNewsSyncResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return {
      ok: false,
      step: 'admin_auth',
      error: auth.code,
      message: auth.error,
    };
  }

  return runHackerNewsSync({ force });
}
