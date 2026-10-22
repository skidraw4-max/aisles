'use client';

import { useCallback, useMemo, type MouseEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** 홈 복도 ALL — `?category=` 없음 */
export const HOME_ALL_HREF = '/';

/** `?category=`만 제거한 ALL 탭 href (posted 등 다른 쿼리는 유지) */
export function homeAllHrefFromSearchString(search: string): string {
  const next = new URLSearchParams(search);
  next.delete('category');
  const qs = next.toString();
  return qs ? `/?${qs}` : HOME_ALL_HREF;
}

/** 현재 URL 기준 ALL 탭 href */
export function useHomeAllHref(): string {
  const searchParams = useSearchParams();
  return useMemo(
    () => homeAllHrefFromSearchString(searchParams.toString()),
    [searchParams]
  );
}

/**
 * `/?category=LAB` 등에서 ALL로 — pathname이 같아 Link 기본 이동이 무시되는 경우가 있어
 * 명시적으로 push 한다. `router.refresh()`와 동시 호출 시 RSC 경합(digest 669395136)이 나므로
 * refresh는 쓰지 않는다.
 */
export function useNavigateHomeAll() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const homeAllHref = useHomeAllHref();

  return useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      if (pathname !== '/') return;
      if (!searchParams.get('category')?.trim()) return;
      e.preventDefault();
      router.push(homeAllHref, { scroll: false });
    },
    [pathname, router, searchParams, homeAllHref]
  );
}
