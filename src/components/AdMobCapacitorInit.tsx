'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import {
  hideBannerAd,
  hideInFeedMrec,
  initializeAdMob,
  isInFeedMrecActive,
  resumeBannerAd,
  shouldHideAdsForPath,
  showBannerAd,
} from '@/lib/admob-capacitor';

/**
 * Capacitor Android 앱에서 AdMob 배너를 초기화·표시합니다.
 * 로그인/인증 경로에서는 배너를 숨겨 헤더·폼과 겹치지 않게 합니다.
 */
export function AdMobCapacitorInit() {
  const pathname = usePathname() ?? '/';

  useEffect(() => {
    if (!isCapacitorNative()) return;

    const syncBanner = async () => {
      await initializeAdMob();
      if (shouldHideAdsForPath(pathname)) {
        await hideInFeedMrec();
        await hideBannerAd();
        return;
      }
      if (!isInFeedMrecActive()) {
        await showBannerAd();
      }
    };

    void syncBanner();
  }, [pathname]);

  useEffect(() => {
    if (!isCapacitorNative()) return;

    let listener: { remove: () => Promise<void> } | undefined;
    let cancelled = false;

    void (async () => {
      const { App } = await import('@capacitor/app');
      if (cancelled) return;
      listener = await App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive || shouldHideAdsForPath(pathname)) return;
        void resumeBannerAd();
      });
    })();

    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, [pathname]);

  return null;
}
