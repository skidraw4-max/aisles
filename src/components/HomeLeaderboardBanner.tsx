'use client';

import { AdBanner } from '@/components/AdBanner';
import { getKakaoAdfitMainBannerUnitId } from '@/lib/kakao-adfit';
import styles from '@/app/(root)/page.module.css';

/** 홈 리더보드(728×90) — 탭 아래 고정 마운트, ALL·복도 공통 ins 유지 */
export function HomeLeaderboardBanner() {
  return (
    <div className={styles.corridorStripAdWrap}>
      <AdBanner variant="kakao-leaderboard" adUnit={getKakaoAdfitMainBannerUnitId()} />
    </div>
  );
}
