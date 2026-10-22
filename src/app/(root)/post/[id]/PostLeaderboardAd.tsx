'use client';

import { AdBanner } from '@/components/AdBanner';
import { getKakaoAdfitPostBannerUnitId } from '@/lib/kakao-adfit';
import styles from './post.module.css';

type Props = {
  postId: string;
};

/** 게시글 본문-방문 CTA 사이 리더보드(728×90 / 320×100) — 웹 전용, remountKey로 슬롯 재마운트 */
export function PostLeaderboardAd({ postId }: Props) {
  return (
    <aside className={styles.postLeaderboardAdWrap} aria-label="광고">
      <AdBanner
        variant="kakao-leaderboard"
        adUnit={getKakaoAdfitPostBannerUnitId()}
        remountKey={postId}
      />
    </aside>
  );
}
