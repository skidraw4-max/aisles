import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * NextResponse에 원본 요청 헤더를 넘겨 RSC/정적 자산 연계가 깨지지 않게 함 (Next 15 권장 패턴).
 */
function nextWithRequest(request: NextRequest) {
  return NextResponse.next({
    request: {
      headers: request.headers,
    },
  });
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = nextWithRequest(request);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = nextWithRequest(request);
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith('/upload')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', '/upload');
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

/**
 * `/_next/*`·`/api/*` 는 절대 미들웨어를 타지 않게 함.
 * (화이트리스트만 쓰면 path-to-regexp/내부 경로 조합에 따라 일부 페이지에서만 JS·CSS 404가 날 수 있음)
 */
export const config = {
  matcher: ['/((?!_next/|api/).*)'],
};
