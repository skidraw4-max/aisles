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

/** 비인증 사용자도 접근 허용 — 아래 보호 리다이렉트에서 제외 */
const PUBLIC_PATH_PREFIXES = ['/reset-password'] as const;

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function middleware(request: NextRequest) {
  // Supabase가 redirectTo 미허용 시 Site URL의 루트로만 ?code= 붙여 보내는 경우:
  // 홈은 코드 교환을 하지 않으므로 콜백으로 넘겨 세션 만든 뒤 비밀번호 변경 페이지로 보냄.
  if (request.nextUrl.pathname === '/' && request.nextUrl.searchParams.has('code')) {
    const u = request.nextUrl.clone();
    u.pathname = '/auth/reset-callback';
    return NextResponse.redirect(u);
  }

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

  const pathname = request.nextUrl.pathname;
  if (isPublicPath(pathname)) {
    return supabaseResponse;
  }

  if (!user && pathname.startsWith('/upload')) {
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
