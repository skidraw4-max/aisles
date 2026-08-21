'use client';

import { useState } from 'react';
import { sendGAEvent } from '@/lib/ga4';
import { getPublicSiteUrl } from '@/lib/site-url';
import styles from './games.module.css';

type Props = {
  slug: string;
  title: string;
};

/** 게임 상세 공유 — Web Share / clipboard. 스코어 동적 OG는 defer. */
export function GameShareButton({ slug, title }: Props) {
  const [copied, setCopied] = useState(false);

  const shareUrl = () => {
    const base = getPublicSiteUrl().replace(/\/$/, '');
    return `${base}/games/${slug}`;
  };

  const onShare = async () => {
    const url = shareUrl();
    const text = `${title} — AIsle 게임 랭킹에 도전해 보세요`;
    sendGAEvent('share_click', { method: 'game_detail', game_slug: slug });
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title, text, url });
        return;
      }
    } catch {
      /* fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <button type="button" className={styles.shareBtn} onClick={() => void onShare()}>
      {copied ? '링크 복사됨' : '공유하기'}
    </button>
  );
}
