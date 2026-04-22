import type { SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

function readSupabaseBrowserConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

/**
 * 공개 env가 빌드에 포함되지 않은 경우 null.
 * 레이아웃 전역 `SessionProvider` 등은 크래시 대신 이 경로를 써야 합니다.
 */
export function tryCreateBrowserClient(): SupabaseClient | null {
  const cfg = readSupabaseBrowserConfig();
  if (!cfg) return null;
  return createBrowserClient(cfg.url, cfg.key);
}

export function createClient(): SupabaseClient {
  const cfg = readSupabaseBrowserConfig();
  if (!cfg) {
    throw new Error(
      [
        'Supabase 클라이언트 설정이 없습니다.',
        '.env에 다음을 넣고 dev 서버를 다시 시작하세요:',
        '  NEXT_PUBLIC_SUPABASE_URL=https://<프로젝트-ref>.supabase.co',
        '  NEXT_PUBLIC_SUPABASE_ANON_KEY=<Dashboard → Settings → API 의 anon public 키>',
        'https://supabase.com/dashboard/project/_/settings/api',
      ].join('\n')
    );
  }
  return createBrowserClient(cfg.url, cfg.key);
}
