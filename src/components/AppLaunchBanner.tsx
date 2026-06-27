'use client';

import { QRCodeSVG } from 'qrcode.react';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import { PLAY_STORE_URL } from '@/lib/mobile-app';
import styles from './AppLaunchBanner.module.css';

const QR_SIZE = 112;

export function AppLaunchBanner() {
  if (isCapacitorNative()) return null;

  return (
    <div className={styles.wrap}>
      <aside className={styles.banner} aria-label="Android 앱 출시 안내">
        <div className={styles.textCol}>
          <p className={styles.badge}>NEW · Android 앱 출시</p>
          <h2 className={styles.headline}>AIsle 앱으로 AI 트렌드를 더 편하게</h2>
          <p className={styles.body}>
            웹과 동일한 피드·복도·AI FORTUNE을 앱에서 바로 이용하세요.
          </p>
          <p className={styles.sub}>Google Play에서 AIsle 검색 또는 QR 코드로 설치</p>
          <a
            href={PLAY_STORE_URL}
            className={styles.cta}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Play에서 받기
          </a>
        </div>
        <div className={styles.qrCol}>
          <a
            href={PLAY_STORE_URL}
            className={styles.qrLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Google Play에서 AIsle 앱 설치 (새 탭)"
          >
            <QRCodeSVG value={PLAY_STORE_URL} size={QR_SIZE} level="M" />
          </a>
          <p className={styles.qrCaption}>스마트폰으로 스캔</p>
        </div>
      </aside>
    </div>
  );
}
