'use server';

import { requireAdminAction } from '@/lib/auth/require-admin';
import { runTechmemeSync, type TechmemeSyncResult } from '@/lib/techmeme/run-techmeme-sync';

/** 관리자 전용 — 공지 관리 화면에서 Techmeme 동기화 트리거 */
export async function runTechmemeSyncAdminAction(force: boolean): Promise<TechmemeSyncResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return {
      ok: false,
      step: 'admin_auth',
      error: auth.code,
      message: auth.error,
    };
  }

  return runTechmemeSync({ force });
}
