import { createClient } from '@supabase/supabase-js';
import { requireSupabaseTarget } from '@/lib/jury-product/supabase-target-guard.cjs';

/** Supabase Dashboard → Settings → API → service_role (절대 클라이언트에 노출 금지) */
export function getServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;
}

export function hasServiceRoleKey(): boolean {
  return !!getServiceRoleKey();
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = getServiceRoleKey();
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  }
  // Preview only: throws Error(<fixed code>) before any client exists. No-op in Production.
  requireSupabaseTarget(process.env, { checkAnonKey: false, requireServiceKey: true });
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
