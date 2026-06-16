'use client';

import { useEffect, useRef } from 'react';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import { initializeAdMob, registerInFeedMrecSlot } from '@/lib/admob-capacitor';
import styles from './NativeAdSlot.module.css';

type Props = {
  /** 피드 내 슬롯 인덱스 (0 = 5번째 게시글 뒤) */
  slotIndex?: number;
  /** fullWidthRow: 그리드 전체 열 스팬 / boardRow: 게시판 목록 행 */
  variant?: 'fullWidthRow' | 'boardRow';
};

/**
 * 인피드 MREC 슬롯 (원본 300×250의 1/3, 100×83).
 * Capacitor 네이티브 전용 — DOM 슬롯 좌표에 맞춰 AislesAd 플러그인으로 축소·중앙 정렬 오버레이.
 */
export function NativeAdSlot({ slotIndex = 0, variant = 'fullWidthRow' }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isCapacitorNative()) return;
    void initializeAdMob();
  }, []);

  useEffect(() => {
    if (!isCapacitorNative()) return;
    const el = slotRef.current;
    if (!el) return;
    return registerInFeedMrecSlot(slotIndex, el);
  }, [slotIndex]);

  if (!isCapacitorNative()) return null;

  return (
    <div
      ref={slotRef}
      className={variant === 'boardRow' ? styles.boardRowSlot : styles.fullWidthRowSlot}
      role="complementary"
      aria-label="광고"
      data-admob-slot="mrec-infeed"
      data-ad-index={slotIndex}
    >
      <span className={styles.placeholderBadge}>광고</span>
    </div>
  );
}
