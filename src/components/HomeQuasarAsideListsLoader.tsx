'use client';

import nextDynamic from 'next/dynamic';
import type { QuasarAsidePost } from '@/components/HomeQuasarAsideLists';
import styles from '@/app/(root)/page.module.css';

const HomeQuasarAsideLists = nextDynamic(
  () => import('@/components/HomeQuasarAsideLists').then((m) => ({ default: m.HomeQuasarAsideLists })),
  {
    ssr: false,
    loading: () => (
      <aside className={styles.quasarBoardAside} aria-label="라운지·가십 최신" aria-busy="true">
        <div className={`${styles.quasarAsidePanel} ${styles.dynamicClientAsideFallback}`} />
        <div className={`${styles.quasarAsidePanel} ${styles.dynamicClientAsideFallback}`} />
      </aside>
    ),
  }
);

type Props = {
  lounge: QuasarAsidePost[];
  gossip: QuasarAsidePost[];
  loungeTitle: string;
  gossipTitle: string;
  asideAriaLabel: string;
  emptyMessage: string;
};

export function HomeQuasarAsideListsLoader(props: Props) {
  return <HomeQuasarAsideLists {...props} />;
}
