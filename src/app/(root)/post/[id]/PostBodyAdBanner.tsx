'use client';

import { AdBanner } from '@/components/AdBanner';
import styles from './post.module.css';

type Props = {
  postId: string;
};

/** 게시글 본문 하단 Kakao 인피드(300×250) — 웹 전용, SPA 글 이동 시 remountKey로 슬롯 재마운트 */
export function PostBodyAdBanner({ postId }: Props) {
  return (
    <aside className={styles.postBodyAdWrap} aria-label="광고">
      <AdBanner variant="kakao-infeed" remountKey={postId} />
    </aside>
  );
}
