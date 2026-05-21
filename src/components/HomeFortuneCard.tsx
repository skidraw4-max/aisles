'use client';

import Link from 'next/link';
import { sendGAEvent } from '@/lib/ga4';
import type { LatestAiFortuneSummary } from '@/lib/ai-fortune/latest-fortune.shared';
import styles from './home-fortune-card.module.css';

type Props = {
  fortune: LatestAiFortuneSummary;
};

export function HomeFortuneCard({ fortune }: Props) {
  const href = `/post/${fortune.id}`;

  return (
    <Link
      href={href}
      className={styles.card}
      onClick={() =>
        sendGAEvent('home_fortune_card_click', { post_id: fortune.id, week_key: fortune.weekKey ?? '' })
      }
    >
      <p className={styles.eyebrow}>🔮 이번 주</p>
      <h2 className={styles.title}>이번 주 AI FORTUNE</h2>
      <p className={styles.subtitle}>
        {fortune.subtitle} · {fortune.title}
      </p>
    </Link>
  );
}
