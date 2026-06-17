'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import { getKakaoAdfitMainBannerUnitId, getKakaoAdfitUnitId } from '@/lib/kakao-adfit';
import { renderAdUnitWithRetry } from '@/lib/kakao-adfit-runtime';
import styles from './AdBanner.module.css';

export type AdBannerVariant = 'kakao-infeed' | 'kakao-leaderboard' | 'adsense';

type KakaoVariant = 'kakao-infeed' | 'kakao-leaderboard';

type Props = {
  variant?: AdBannerVariant;
  adUnit?: string;
  width?: number;
  height?: number;
  /** 홈 복도 탭 등 pathname은 같고 searchParams만 바뀔 때 슬롯 재마운트용 */
  remountKey?: string;
};

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

/**
 * 웹 전용 배너 — Kakao AdFit(인피드·리더보드).
 * ba.min.js는 KakaoAdFitScript로 body 하단 로드. Capacitor 네이티브는 NativeAdSlot.
 */
export function AdBanner({
  variant = 'kakao-infeed',
  adUnit,
  width,
  height,
  remountKey,
}: Props) {
  const pathname = usePathname();
  const slotRemountKey = remountKey ?? pathname;
  const scalerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const isNative = isCapacitorNative();
  const isLeaderboard = variant === 'kakao-leaderboard';
  const shouldActivate = !isNative && isKakaoVariant(variant);
  const resolvedKakao = isKakaoVariant(variant)
    ? resolveKakaoSize(variant, adUnit, width, height)
    : null;
  const kakaoUnit = resolvedKakao?.unit ?? '';
  const kakaoWidth = resolvedKakao?.w ?? 0;
  const kakaoHeight = resolvedKakao?.h ?? 0;

  useEffect(() => {
    if (!shouldActivate || !kakaoUnit) return;
    return renderAdUnitWithRetry(kakaoUnit);
  }, [shouldActivate, kakaoUnit, slotRemountKey]);

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

  const insSlot = (
    <ins
      key={`${slotRemountKey}:${kakaoUnit}`}
      className="kakao_ad_area"
      style={{ display: 'none', width: '100%' }}
      data-ad-unit={kakaoUnit}
      data-ad-width={String(kakaoWidth)}
      data-ad-height={String(kakaoHeight)}
    />
  );

  return (
    <>
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
                <div className={styles.slot}>{insSlot}</div>
              </div>
              <span className={styles.badge}>광고</span>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.wrap}>
          <div className={styles.card} role="complementary" aria-label="광고">
            <div className={styles.slot}>{insSlot}</div>
          </div>
          <span className={styles.badge}>광고</span>
        </div>
      )}
    </>
  );
}
