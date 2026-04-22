'use server';

import { requireAdminAction } from '@/lib/auth/require-admin';
import { runYoutubeSync, type YoutubeSyncResult } from '@/lib/youtube-sync/run-youtube-sync';

/** 관리자 전용 — YouTube(MIT OCW / DeepMind) 동기화 */
export async function runYoutubeSyncAdminAction(force: boolean): Promise<YoutubeSyncResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return {
      ok: false,
      step: 'admin_auth',
      error: auth.code,
      message: auth.error,
    };
  }

  return runYoutubeSync({ force });
}
