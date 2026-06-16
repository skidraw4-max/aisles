'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import { getKakaoAdfitUnitId } from '@/lib/kakao-adfit';
import styles from './AdBanner.module.css';

const KAKAO_SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';

export type AdBannerVariant = 'kakao-infeed' | 'adsense';

type Props = {
  variant?: AdBannerVariant;
  adUnit?: string;
};

let scriptReady = false;
const scriptReadyListeners = new Set<() => void>();

function notifyScriptReady() {
  scriptReady = true;
  for (const listener of scriptReadyListeners) listener();
  scriptReadyListeners.clear();
}

function whenScriptReady(listener: () => void) {
  if (scriptReady) listener();
  else scriptReadyListeners.add(listener);
}

function mountKakaoIns(container: HTMLElement, unit: string) {
  container.innerHTML = '';
  const ins = document.createElement('ins');
  ins.className = 'kakao_ad_area';
  ins.style.display = 'none';
  ins.setAttribute('data-ad-unit', unit);
  ins.setAttribute('data-ad-width', '300');
  ins.setAttribute('data-ad-height', '250');
  container.appendChild(ins);

  requestAnimationFrame(() => {
    ins.style.display = 'block';
    const w = window as Window & { adfit?: { refresh?: () => void } };
    w.adfit?.refresh?.();
  });
}

/**
 * 웹 전용 인피드 배너 — Kakao AdFit(기본) 또는 추후 AdSense 교체용.
 * Capacitor 네이티브에서는 렌더하지 않음 (NativeAdSlot 사용).
 */
export function AdBanner({ variant = 'kakao-infeed', adUnit }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [loadScript, setLoadScript] = useState(false);
  const isNative = isCapacitorNative();
  const unit = variant === 'kakao-infeed' ? getKakaoAdfitUnitId(adUnit) : '';

  useEffect(() => {
    if (isNative || variant !== 'kakao-infeed') return;
    setLoadScript(true);
  }, [isNative, variant]);

  useEffect(() => {
    if (isNative || variant !== 'kakao-infeed') return;
    const container = slotRef.current;
    if (!container) return;

    const mount = () => mountKakaoIns(container, unit);

    if (scriptReady) mount();
    else whenScriptReady(mount);

    return () => {
      container.innerHTML = '';
    };
  }, [isNative, variant, unit]);

  if (isNative) return null;

  if (variant === 'adsense') {
    return null;
  }

  return (
    <>
      {loadScript ? (
        <Script src={KAKAO_SCRIPT_SRC} strategy="afterInteractive" onLoad={notifyScriptReady} />
      ) : null}
      <div className={styles.wrap}>
        <div className={styles.card} role="complementary" aria-label="광고">
          <div className={styles.slot} ref={slotRef} />
          <span className={styles.badge}>광고</span>
        </div>
      </div>
    </>
  );
}
