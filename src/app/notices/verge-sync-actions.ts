'use server';

import { requireAdminAction } from '@/lib/auth/require-admin';
import { runVergeSync, type VergeSyncResult } from '@/lib/verge/run-verge-sync';

/** 관리자 전용 — 공지 관리 화면에서 The Verge 동기화 트리거 */
export async function runVergeSyncAdminAction(force: boolean): Promise<VergeSyncResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return {
      ok: false,
      step: 'admin_auth',
      error: auth.code,
      message: auth.error,
    };
  }

  return runVergeSync({ force });
}
