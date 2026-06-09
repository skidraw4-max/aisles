'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import {
  hideBannerAd,
  hideInFeedMrec,
  initializeAdMob,
  isAppOpenAdEnabled,
  isInFeedMrecActive,
  isInterstitialAdEnabled,
  maybeShowInterstitialAfterNavigation,
  prepareAndShowAppOpenAd,
  resumeBannerAd,
  shouldHideAdsForPath,
  showBannerAd,
} from '@/lib/admob-capacitor';

/**
 * Capacitor Android 앱에서 AdMob 배너를 초기화·표시합니다.
 * 로그인/인증 경로에서는 배너를 숨겨 헤더·폼과 겹치지 않게 합니다.
 *
 * App Open·전면은 env 플래그가 `true` 일 때만 동작하며 기본값은 비노출입니다.
 */
export function AdMobCapacitorInit() {
  const pathname = usePathname() ?? '/';
  const navigationCountRef = useRef(0);
  const wasInBackgroundRef = useRef(false);
  const coldStartAppOpenDoneRef = useRef(false);

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
    if (!isCapacitorNative() || !isAppOpenAdEnabled()) return;
    if (shouldHideAdsForPath(pathname)) return;
    if (coldStartAppOpenDoneRef.current) return;
    coldStartAppOpenDoneRef.current = true;
    void prepareAndShowAppOpenAd();
  }, [pathname]);

  useEffect(() => {
    if (!isCapacitorNative()) return;

    let listener: { remove: () => Promise<void> } | undefined;
    let cancelled = false;

    void (async () => {
      const { App } = await import('@capacitor/app');
      if (cancelled) return;
      listener = await App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          wasInBackgroundRef.current = true;
          return;
        }
        if (!shouldHideAdsForPath(pathname)) {
          void resumeBannerAd();
        }
        if (!isAppOpenAdEnabled() || shouldHideAdsForPath(pathname)) return;
        if (!wasInBackgroundRef.current) return;
        wasInBackgroundRef.current = false;
        void prepareAndShowAppOpenAd();
      });
    })();

    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, [pathname]);

  useEffect(() => {
    if (!isCapacitorNative() || !isInterstitialAdEnabled()) return;
    if (shouldHideAdsForPath(pathname)) return;

    navigationCountRef.current += 1;
    void maybeShowInterstitialAfterNavigation(navigationCountRef.current, pathname);
  }, [pathname]);

  return null;
}
