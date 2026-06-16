'use client';

import { useCallback, type MouseEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** 홈 복도 ALL — `?category=` 없음 */
export const HOME_ALL_HREF = '/';

/**
 * `/?category=LAB` 등에서 ALL(`/`)로 돌아갈 때 Next.js가 pathname만 같다고
 * soft navigation을 생략하는 경우가 있어, 명시적으로 push + refresh 한다.
 */
export function useNavigateHomeAll() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      if (pathname !== '/') return;
      const hasCategory = Boolean(searchParams.get('category')?.trim());
      if (!hasCategory) return;
      e.preventDefault();
      router.push(HOME_ALL_HREF);
      router.refresh();
    },
    [pathname, router, searchParams]
  );
}
