'use client';

import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import {
  ensureAdfitScriptAfterSlots,
  scheduleAdfitRescanAfterNav,
  scanAllAdfitSlots,
  whenAdfitReady,
} from '@/lib/kakao-adfit-runtime';

/** ins.kakao_ad_area가 DOM에 붙은 뒤 마지막 ins 바로 다음에 ba.min.js 1회 주입 */
function KakaoAdFitLoaderInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const categoryKey = searchParams.get('category')?.trim() || 'all';
  const prevCategoryRef = useRef<string | null>(null);

  useEffect(() => {
    if (isCapacitorNative()) return;
    ensureAdfitScriptAfterSlots();
    whenAdfitReady(() => scanAllAdfitSlots());
  }, []);

  useEffect(() => {
    if (isCapacitorNative()) return;
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

export function KakaoAdFitLoader() {
  return (
    <Suspense fallback={null}>
      <KakaoAdFitLoaderInner />
    </Suspense>
  );
}
