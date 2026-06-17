'use client';

import { useCallback, type MouseEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** 홈 복도 ALL — `?category=` 없음 */
export const HOME_ALL_HREF = '/';

/**
 * `/?category=LAB` 등에서 ALL(`/`)로 돌아갈 때 Next.js가 pathname만 같다고
 * soft navigation을 생략하는 경우가 있어, category 쿼리를 제거한 URL로 replace 한다.
 * `router.refresh()`는 push/replace와 동시에 호출하면 RSC 페치가 경합해 500(digest)을
 * 유발할 수 있어 사용하지 않는다 — searchParams 변경만으로 서버 컴포넌트가 재실행된다.
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
      const next = new URLSearchParams(searchParams.toString());
      next.delete('category');
      const qs = next.toString();
      router.replace(qs ? `/?${qs}` : HOME_ALL_HREF, { scroll: false });
    },
    [pathname, router, searchParams]
  );
}
