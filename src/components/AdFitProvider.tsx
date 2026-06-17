'use client';

import { createContext, useContext, useEffect, useRef, Suspense, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { scheduleAdfitRescanAfterNav } from '@/lib/kakao-adfit-runtime';

type AdFitContextValue = {
  /** @deprecated ba.min.js는 KakaoAdFitScript에서 로드 — 컨텍스트는 하위 호환용 */
  scriptReady: boolean;
};

const AdFitContext = createContext<AdFitContextValue>({ scriptReady: true });

export function useAdFitReady(): AdFitContextValue {
  return useContext(AdFitContext);
}

/** 홈 복도 탭(?category=) 전환 시에만 AdFit 재렌더 (초기 로드는 AdBanner가 처리) */
function AdFitHomeTabRescan() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const categoryKey = searchParams.get('category')?.trim() || 'all';
  const prevCategoryRef = useRef<string | null>(null);

  useEffect(() => {
    if (pathname !== '/') return;
    if (prevCategoryRef.current === null) {
      prevCategoryRef.current = categoryKey;
      return;
    }
    if (prevCategoryRef.current === categoryKey) return;
    prevCategoryRef.current = categoryKey;
    return scheduleAdfitRescanAfterNav();
  }, [pathname, categoryKey]);

  return null;
}

/** 웹 AdFit 래퍼 — 마운트 시 구조가 바뀌지 않도록 항상 동일 Provider 트리 유지 */
export function AdFitProvider({ children }: { children: ReactNode }) {
  return (
    <AdFitContext.Provider value={{ scriptReady: true }}>
      <Suspense fallback={null}>
        <AdFitHomeTabRescan />
      </Suspense>
      {children}
    </AdFitContext.Provider>
  );
}
