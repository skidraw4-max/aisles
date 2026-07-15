'use client';

import { useState } from 'react';
import { RANKING_STUBS } from '@/lib/games/catalog';
import styles from './games.module.css';

type RankTab = 'weekly' | 'overall';

export function RankingStub() {
  const [tab, setTab] = useState<RankTab>('weekly');
  const rows = RANKING_STUBS[tab];

  return (
    <section className={styles.rank} id="rank" aria-label="주간 / 전체 랭킹">
      <div className={styles.rankHead}>
        <h2>주간 / 전체 랭킹</h2>
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'weekly'}
            className={`${styles.tab} ${tab === 'weekly' ? styles.tabOn : ''}`}
            onClick={() => setTab('weekly')}
          >
            주간
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'overall'}
            className={`${styles.tab} ${tab === 'overall' ? styles.tabOn : ''}`}
            onClick={() => setTab('overall')}
          >
            전체
          </button>
        </div>
      </div>
      <ol className={styles.rankList}>
        {rows.map((row) => (
          <li key={`${tab}-${row.rank}`}>
            <span>{row.rank}</span>
            <span>{row.name}</span>
            <span>{row.score}</span>
          </li>
        ))}
        <li className={styles.rankMuted}>
          <span>—</span>
          <span>스텁 데이터</span>
          <span>—</span>
        </li>
      </ol>
    </section>
  );
}
