'use client';

import { useEffect, useRef, useState } from 'react';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import {
  getKakaoAdfitMainBannerUnitId,
  getKakaoAdfitUnitId,
  KAKAO_LEADERBOARD_DESKTOP_HEIGHT,
  KAKAO_LEADERBOARD_DESKTOP_WIDTH,
  KAKAO_LEADERBOARD_MIN_FILL_WIDTH,
  KAKAO_LEADERBOARD_MOBILE_HEIGHT,
  KAKAO_LEADERBOARD_MOBILE_WIDTH,
} from '@/lib/kakao-adfit';
import { KakaoAdSlot } from '@/components/KakaoAdSlot';
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
 * ba.min.js는 KakaoAdFitLoader가 ins 뒤에 1회 주입. Capacitor 네이티브는 NativeAdSlot.
 */
export function AdBanner({
  variant = 'kakao-infeed',
  adUnit,
  width,
  height,
  remountKey,
}: Props) {
  const scalerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [isCompactLeaderboard, setIsCompactLeaderboard] = useState(false);
  const isNative = isCapacitorNative();
  const isLeaderboard = variant === 'kakao-leaderboard';
  const resolvedKakao = isKakaoVariant(variant)
    ? resolveKakaoSize(variant, adUnit, width, height)
    : null;
  const kakaoUnit = resolvedKakao?.unit ?? '';
  const kakaoWidth = resolvedKakao?.w ?? 0;
  const kakaoHeight = resolvedKakao?.h ?? 0;
  const slotWidth =
    isLeaderboard && isCompactLeaderboard ? KAKAO_LEADERBOARD_MOBILE_WIDTH : kakaoWidth;
  const slotHeight =
    isLeaderboard && isCompactLeaderboard ? KAKAO_LEADERBOARD_MOBILE_HEIGHT : kakaoHeight;
  const shouldScaleLeaderboard = isLeaderboard && !isCompactLeaderboard;

  useEffect(() => {
    if (isNative || !isLeaderboard) return;
    const scaler = scalerRef.current;
    if (!scaler) return;
    const outer = scaler.parentElement;
    if (!outer) return;

    const updateLayout = () => {
      const available = outer.clientWidth;
      const compact = available > 0 && available < KAKAO_LEADERBOARD_MIN_FILL_WIDTH;
      setIsCompactLeaderboard(compact);
      setScale(
        compact
          ? 1
          : available < KAKAO_LEADERBOARD_DESKTOP_WIDTH
            ? available / KAKAO_LEADERBOARD_DESKTOP_WIDTH
            : 1
      );
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [isNative, isLeaderboard]);

  if (isNative) return null;

  if (variant === 'adsense') {
    return null;
  }

  const insSlot = (
    <KakaoAdSlot
      key={`${remountKey ?? 'default'}:${kakaoUnit}:${slotWidth}x${slotHeight}`}
      unit={kakaoUnit}
      width={slotWidth}
      height={slotHeight}
    />
  );

  return (
    <>
      {isLeaderboard ? (
        <div
          className={`${styles.leaderboardWrap} ${isCompactLeaderboard ? styles.leaderboardWrapCompact : ''}`}
        >
          <div
            className={styles.leaderboardOuter}
            style={{ height: `${Math.round(slotHeight * (shouldScaleLeaderboard ? scale : 1))}px` }}
          >
            <div
              className={styles.leaderboardScaler}
              ref={scalerRef}
              style={{
                width: `${slotWidth}px`,
                height: `${slotHeight}px`,
                transform:
                  shouldScaleLeaderboard && scale < 1 ? `scale(${scale})` : undefined,
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
