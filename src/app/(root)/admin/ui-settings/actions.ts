'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAdminAction } from '@/lib/auth/require-admin';
import { UI_CONFIG_SEED } from '@/lib/ui-config-defaults';

export type SaveUiConfigResult = { ok: true } | { ok: false; error: string };

export async function saveUiConfigAction(updates: { key: string; value: string }[]): Promise<SaveUiConfigResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }

  try {
    for (const u of updates) {
      const desc = UI_CONFIG_SEED.find((r) => r.key === u.key)?.description ?? null;
      await prisma.uiConfig.upsert({
        where: { key: u.key },
        create: { key: u.key, value: u.value, description: desc },
        update: { value: u.value },
      });
    }
  } catch (e) {
    console.error('[saveUiConfigAction]', e);
    return { ok: false, error: '저장에 실패했습니다.' };
  }

  revalidatePath('/');
  revalidatePath('/admin/ui-settings');
  return { ok: true };
}
