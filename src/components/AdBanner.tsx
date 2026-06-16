'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import { getKakaoAdfitMainBannerUnitId, getKakaoAdfitUnitId } from '@/lib/kakao-adfit';
import styles from './AdBanner.module.css';

const KAKAO_SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';

export type AdBannerVariant = 'kakao-infeed' | 'kakao-leaderboard' | 'adsense';

type KakaoVariant = 'kakao-infeed' | 'kakao-leaderboard';

type Props = {
  variant?: AdBannerVariant;
  adUnit?: string;
  width?: number;
  height?: number;
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

function isKakaoVariant(variant: AdBannerVariant): variant is KakaoVariant {
  return variant === 'kakao-infeed' || variant === 'kakao-leaderboard';
}

function resolveKakaoSize(
  variant: KakaoVariant,
  adUnit: string | undefined,
  width: number | undefined,
  height: number | undefined
): { unit: string; w: number; h: number } {
  if (variant === 'kakao-leaderboard') {
    return {
      unit: getKakaoAdfitMainBannerUnitId(adUnit),
      w: width ?? 728,
      h: height ?? 90,
    };
  }
  return {
    unit: getKakaoAdfitUnitId(adUnit),
    w: width ?? 300,
    h: height ?? 250,
  };
}

function mountKakaoIns(container: HTMLElement, unit: string, width: number, height: number) {
  container.innerHTML = '';
  const ins = document.createElement('ins');
  ins.className = 'kakao_ad_area';
  ins.style.display = 'none';
  ins.setAttribute('data-ad-unit', unit);
  ins.setAttribute('data-ad-width', String(width));
  ins.setAttribute('data-ad-height', String(height));
  container.appendChild(ins);

  requestAnimationFrame(() => {
    ins.style.display = 'block';
    const w = window as Window & { adfit?: { refresh?: () => void } };
    w.adfit?.refresh?.();
  });
}

/**
 * 웹 전용 배너 — Kakao AdFit(인피드·리더보드) 또는 추후 AdSense 교체용.
 * Capacitor 네이티브에서는 렌더하지 않음 (NativeAdSlot 사용).
 */
export function AdBanner({
  variant = 'kakao-infeed',
  adUnit,
  width,
  height,
}: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const [loadScript, setLoadScript] = useState(false);
  const [scale, setScale] = useState(1);
  const isNative = isCapacitorNative();
  const isLeaderboard = variant === 'kakao-leaderboard';
  const resolvedKakao = isKakaoVariant(variant)
    ? resolveKakaoSize(variant, adUnit, width, height)
    : null;
  const kakaoUnit = resolvedKakao?.unit ?? '';
  const kakaoWidth = resolvedKakao?.w ?? 0;
  const kakaoHeight = resolvedKakao?.h ?? 0;

  useEffect(() => {
    if (isNative || !isKakaoVariant(variant)) return;
    setLoadScript(true);
  }, [isNative, variant]);

  useEffect(() => {
    if (isNative || !isKakaoVariant(variant)) return;
    const container = slotRef.current;
    if (!container) return;

    const mount = () => mountKakaoIns(container, kakaoUnit, kakaoWidth, kakaoHeight);

    if (scriptReady) mount();
    else whenScriptReady(mount);

    return () => {
      container.innerHTML = '';
    };
  }, [isNative, variant, kakaoUnit, kakaoWidth, kakaoHeight]);

  useEffect(() => {
    if (isNative || !isLeaderboard) return;
    const scaler = scalerRef.current;
    if (!scaler) return;

    const updateScale = () => {
      const parent = scaler.parentElement;
      if (!parent) return;
      const available = parent.clientWidth;
      setScale(available < kakaoWidth ? available / kakaoWidth : 1);
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(scaler.parentElement ?? scaler);
    return () => observer.disconnect();
  }, [isNative, isLeaderboard, kakaoWidth]);

  if (isNative) return null;

  if (variant === 'adsense') {
    return null;
  }

  const slot = <div className={styles.slot} ref={slotRef} />;

  return (
    <>
      {loadScript ? (
        <Script src={KAKAO_SCRIPT_SRC} strategy="afterInteractive" onLoad={notifyScriptReady} />
      ) : null}
      {isLeaderboard ? (
        <div className={styles.leaderboardWrap}>
          <div
            className={styles.leaderboardOuter}
            style={{ height: `${Math.round(kakaoHeight * scale)}px` }}
          >
            <div
              className={styles.leaderboardScaler}
              ref={scalerRef}
              style={{
                width: `${kakaoWidth}px`,
                height: `${kakaoHeight}px`,
                transform: scale < 1 ? `scale(${scale})` : undefined,
              }}
            >
              <div className={styles.leaderboardCard} role="complementary" aria-label="광고">
                {slot}
                <span className={styles.badge}>광고</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.wrap}>
          <div className={styles.card} role="complementary" aria-label="광고">
            {slot}
            <span className={styles.badge}>광고</span>
          </div>
        </div>
      )}
    </>
  );
}
