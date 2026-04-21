'use server';

import { requireAdminAction } from '@/lib/auth/require-admin';
import { runAiBreakfastSync, type AiBreakfastSyncResult } from '@/lib/aibreakfast/run-aibreakfast-sync';

/** 관리자 전용 — 공지 관리 화면에서 AI Breakfast 동기화 트리거 */
export async function runAiBreakfastSyncAdminAction(force: boolean): Promise<AiBreakfastSyncResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return {
      ok: false,
      step: 'admin_auth',
      error: auth.code,
      message: auth.error,
    };
  }

  return runAiBreakfastSync({ force });
}
