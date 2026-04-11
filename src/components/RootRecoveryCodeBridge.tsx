'use client';

import { useEffect } from 'react';

/**
 * Supabase가 `redirect_to`를 사이트 루트만 주면 `/?code=`로 도착한다.
 * 미들웨어가 적용되지 않는 환경에서도 reset-callback으로 넘김.
 */
export function RootRecoveryCodeBridge() {
  useEffect(() => {
    const { pathname, search } = window.location;
    if (pathname !== '/') return;
    if (!new URLSearchParams(search).has('code')) return;
    window.location.replace(`/auth/reset-callback${search}`);
  }, []);
  return null;
}
