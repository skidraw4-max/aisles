'use client';

import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import {
  ensureAdfitScriptAfterSlots,
  renderAllAdfitUnitsInDom,
  whenAdfitReady,
} from '@/lib/kakao-adfit-runtime';

const NAV_RESCAN_DELAYS_MS = [0, 150, 400, 800];

function KakaoAdFitLoaderInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const categoryKey = searchParams.get('category')?.trim() || 'all';
  const prevCategoryRef = useRef<string | null>(null);

  useEffect(() => {
    if (isCapacitorNative()) return;

    ensureAdfitScriptAfterSlots();

    const observer = new MutationObserver(() => {
      ensureAdfitScriptAfterSlots();
      if (document.querySelector('script[data-aisle-kakao-adfit]')) {
        whenAdfitReady(() => renderAllAdfitUnitsInDom());
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (pathname !== '/') return;
    if (prevCategoryRef.current === null) {
      prevCategoryRef.current = categoryKey;
      return;
    }
    if (prevCategoryRef.current === categoryKey) return;
    prevCategoryRef.current = categoryKey;

    const timers = NAV_RESCAN_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        ensureAdfitScriptAfterSlots();
        whenAdfitReady(() => renderAllAdfitUnitsInDom());
      }, delay)
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [pathname, categoryKey]);

  return null;
}

/** ins.kakao_ad_area가 DOM에 붙은 뒤 마지막 ins 바로 다음에 ba.min.js 1회 주입 */
export function KakaoAdFitLoader() {
  return (
    <Suspense fallback={null}>
      <KakaoAdFitLoaderInner />
    </Suspense>
  );
}
