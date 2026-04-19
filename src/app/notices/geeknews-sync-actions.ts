'use server';

import { requireAdminAction } from '@/lib/auth/require-admin';
import { runGeekNewsSync } from '@/lib/geeknews/run-geeknews-sync';

/** 관리자 전용 — 공지 관리 화면에서 GeekNews 동기화 트리거 */
export async function runGeekNewsSyncAdminAction(force: boolean): Promise<GeekNewsSyncResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return {
      ok: false,
      step: 'admin_auth',
      error: auth.code,
      message: auth.error,
    };
  }

  return runGeekNewsSync({ force });
}
