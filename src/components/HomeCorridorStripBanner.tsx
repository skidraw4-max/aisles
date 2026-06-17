'use client';

import { AdBanner } from '@/components/AdBanner';
import { getKakaoAdfitCorridorBannerUnitId } from '@/lib/kakao-adfit';
import styles from '@/app/(root)/page.module.css';

/** 복도 탭 전용 — 탭 메뉴 바로 아래 728×90 띠배너 (웹만, AdBanner 내부에서 네이티브 제외) */
export function HomeCorridorStripBanner() {
  return (
    <div className={styles.corridorStripAdWrap}>
      <AdBanner
        variant="kakao-leaderboard"
        adUnit={getKakaoAdfitCorridorBannerUnitId()}
      />
    </div>
  );
}
