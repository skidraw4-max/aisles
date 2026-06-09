'use client';

import { useEffect } from 'react';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import { prepareNativeAdSlot } from '@/lib/admob-capacitor';
import styles from './NativeAdSlot.module.css';

/**
 * 홈 피드용 네이티브 광고 슬롯 (레이아웃·초기화 훅).
 * @capacitor-community/admob 는 Native 형식을 지원하지 않아
 * 현재는 SDK 초기화만 보장하고 DOM 슬롯을 예약합니다.
 */
export function NativeAdSlot() {
  useEffect(() => {
    if (!isCapacitorNative()) return;
    void prepareNativeAdSlot();
  }, []);

  if (!isCapacitorNative()) return null;

  return (
    <div
      className={styles.slot}
      role="complementary"
      aria-label="광고"
      data-admob-slot="native-reserved"
    />
  );
}
