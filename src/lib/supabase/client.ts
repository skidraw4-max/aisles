import { createBrowserClient } from '@supabase/ssr';

function getSupabaseBrowserConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
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
  return { url, key };
}

export function createClient() {
  const { url, key } = getSupabaseBrowserConfig();
  return createBrowserClient(url, key);
}
