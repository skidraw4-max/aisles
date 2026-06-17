'use client';

import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import { renderAllAdfitUnitsInDom, whenAdfitReady } from '@/lib/kakao-adfit-runtime';

const NAV_RESCAN_DELAYS_MS = [0, 150, 400, 800, 1500];

/** 복도 탭 전환 등으로 ins가 갱신될 때 render만 재호출 (destroy 금지) */
function KakaoAdFitTabRescan() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const categoryKey = searchParams.get('category')?.trim() || 'all';
  const prevCategoryRef = useRef<string | null>(null);

  useEffect(() => {
    if (isCapacitorNative()) return;
    if (pathname !== '/') return;

    const timers = NAV_RESCAN_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        whenAdfitReady(() => renderAllAdfitUnitsInDom());
      }, delay)
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [pathname]);

  useEffect(() => {
    if (isCapacitorNative()) return;
    if (pathname !== '/') return;
    if (prevCategoryRef.current === null) {
      prevCategoryRef.current = categoryKey;
      return;
    }
    if (prevCategoryRef.current === categoryKey) return;
    prevCategoryRef.current = categoryKey;

    const timers = NAV_RESCAN_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        whenAdfitReady(() => renderAllAdfitUnitsInDom());
      }, delay)
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [pathname, categoryKey]);

  return null;
}

export function KakaoAdFitLoader() {
  return (
    <Suspense fallback={null}>
      <KakaoAdFitTabRescan />
    </Suspense>
  );
}
