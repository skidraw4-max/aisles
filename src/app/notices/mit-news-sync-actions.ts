'use server';

import { requireAdminAction } from '@/lib/auth/require-admin';
import { runMitNewsSync, type MitNewsSyncResult } from '@/lib/mit-news/run-mit-news-sync';

/** 관리자 전용 — 공지 관리 화면에서 MIT News 동기화 트리거 */
export async function runMitNewsSyncAdminAction(force: boolean): Promise<MitNewsSyncResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return {
      ok: false,
      step: 'admin_auth',
      error: auth.code,
      message: auth.error,
    };
  }

  return runMitNewsSync({ force });
}
