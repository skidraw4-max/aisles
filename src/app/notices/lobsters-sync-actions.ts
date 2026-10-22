'use server';

import { requireAdminAction } from '@/lib/auth/require-admin';
import { runLobstersSync, type LobstersSyncResult } from '@/lib/lobsters/run-lobsters-sync';

/** 관리자 전용 — 공지 관리 화면에서 Lobsters 동기화 트리거 */
export async function runLobstersSyncAdminAction(force: boolean): Promise<LobstersSyncResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return {
      ok: false,
      step: 'admin_auth',
      error: auth.code,
      message: auth.error,
    };
  }

  return runLobstersSync({ force });
}
