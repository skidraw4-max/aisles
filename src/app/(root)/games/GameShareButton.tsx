'use client';

import { useState } from 'react';
import { sendGAEvent } from '@/lib/ga4';
import { getPublicSiteUrl } from '@/lib/site-url';
import { copyTextToClipboard } from '@/lib/clipboard-copy';
import { buildKakaoShareUrl, buildXShareUrl } from '@/lib/share-social';
import styles from './games.module.css';

type Props = {
  slug: string;
  title: string;
};

/** 게임 상세 공유 — Web Share / clipboard + X·카카오 재공유 */
export function GameShareButton({ slug, title }: Props) {
  const [copied, setCopied] = useState(false);
  const [reshareUrl, setReshareUrl] = useState<string | null>(null);

  const sharePageUrl = () => {
    const base = getPublicSiteUrl().replace(/\/$/, '');
    return `${base}/games/${slug}`;
  };

  const onShare = async () => {
    const url = sharePageUrl();
    const text = `${title} — AIsle 게임 주간 랭킹에 도전해 보세요`;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title, text, url });
        sendGAEvent('share_click', { method: 'web_share', game_slug: slug });
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      await copyTextToClipboard(url);
      setCopied(true);
      setReshareUrl(url);
      window.setTimeout(() => setCopied(false), 2500);
      sendGAEvent('share_click', { method: 'clipboard', game_slug: slug });
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={styles.shareWrap}>
      <button type="button" className={styles.shareBtn} onClick={() => void onShare()}>
        {copied ? '링크 복사됨' : '공유하기'}
      </button>
      {reshareUrl ? (
        <p className={styles.shareReshare} role="status">
          복사됨 ·{' '}
          <a
            href={buildXShareUrl(reshareUrl, `${title} 주간 랭킹`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            X에 공유
          </a>
          {' · '}
          <a href={buildKakaoShareUrl(reshareUrl)} target="_blank" rel="noopener noreferrer">
            카카오 공유
          </a>
        </p>
      ) : null}
    </div>
  );
}
