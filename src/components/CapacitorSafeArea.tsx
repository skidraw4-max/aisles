'use client';

import { useEffect } from 'react';
import { isCapacitorNative } from '@/lib/capacitor-oauth';

const ANDROID_MIN_TOP_PX = 28;
const IOS_MIN_TOP_PX = 20;

function readEnvSafeAreaTopPx(): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;padding-top:constant(safe-area-inset-top);padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;';
  document.documentElement.appendChild(probe);
  const top = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return top;
}

function estimateAndroidStatusBarPx(): number {
  const vvTop = window.visualViewport?.offsetTop ?? 0;
  const density = window.devicePixelRatio || 1;
  const dp24 = Math.round(24 * density);
  return Math.max(vvTop, dp24, ANDROID_MIN_TOP_PX);
}

function resolvePlatform(): 'ios' | 'android' | 'web' {
  const cap = (window as Window & { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const platform = cap?.getPlatform?.() ?? 'web';
  if (platform === 'ios') return 'ios';
  if (platform === 'android') return 'android';
  return 'web';
}

async function configureNativeStatusBar(): Promise<void> {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0b0d17' });
  } catch {
    // StatusBar plugin unavailable outside native shell
  }
}

function computeTopInsetPx(platform: 'ios' | 'android' | 'web'): number {
  const envTop = readEnvSafeAreaTopPx();
  if (platform === 'ios') {
    return Math.max(envTop, IOS_MIN_TOP_PX);
  }
  if (platform === 'android') {
    return Math.max(envTop, estimateAndroidStatusBarPx(), ANDROID_MIN_TOP_PX);
  }
  return envTop;
}

/**
 * Capacitor WebView(특히 Android)에서 env(safe-area-inset-top)이 0인 경우가 많아
 * --app-safe-area-top 과 html.capacitor-native 클래스로 보장된 상단 inset 을 설정합니다.
 */
export function CapacitorSafeArea() {
  useEffect(() => {
    if (!isCapacitorNative()) return;

    const html = document.documentElement;
    const body = document.body;
    html.classList.add('capacitor-native');
    body.classList.add('capacitor-native');

    const platform = resolvePlatform();

    const applyInsets = async () => {
      await configureNativeStatusBar();
      const topPx = computeTopInsetPx(platform);
      html.style.setProperty('--app-safe-area-top', `${topPx}px`);
    };

    void applyInsets();

    const onViewportChange = () => {
      const topPx = computeTopInsetPx(platform);
      html.style.setProperty('--app-safe-area-top', `${topPx}px`);
    };

    window.visualViewport?.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('scroll', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    window.addEventListener('resize', onViewportChange);

    return () => {
      html.classList.remove('capacitor-native');
      body.classList.remove('capacitor-native');
      html.style.removeProperty('--app-safe-area-top');
      window.visualViewport?.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('scroll', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
    };
  }, []);

  return null;
}
