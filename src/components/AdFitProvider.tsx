'use client';

import { createContext, useContext, useEffect, Suspense, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { scheduleAdfitRescanAfterNav } from '@/lib/kakao-adfit-runtime';

type AdFitContextValue = {
  /** @deprecated ba.min.js는 layout에서 정적 로드 — 컨텍스트는 하위 호환용 */
  scriptReady: boolean;
};

const AdFitContext = createContext<AdFitContextValue>({ scriptReady: true });

export function useAdFitReady(): AdFitContextValue {
  return useContext(AdFitContext);
}

/** 홈 복도 탭(?category=) 전환 시 AdFit 전체 재스캔 */
function AdFitHomeTabRescan() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const categoryKey = searchParams.get('category')?.trim() || 'all';

  useEffect(() => {
    if (pathname !== '/') return;
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
