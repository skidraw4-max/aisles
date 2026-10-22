'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { List } from 'lucide-react';
import type { RollingNoticeDTO } from '@/app/notices/actions';
import styles from './NoticeBar.module.css';

type Props = {
  notices: RollingNoticeDTO[];
};

export function NoticeBar({ notices }: Props) {
  const list = useMemo(() => notices.filter((n) => n.title?.trim()), [notices]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (list.length <= 1) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleNext = () => {
      const ms = 3000 + Math.random() * 2000;
      timeoutId = setTimeout(() => {
        setIndex((i) => (i + 1) % list.length);
        scheduleNext();
      }, ms);
    };
    scheduleNext();
    return () => clearTimeout(timeoutId);
  }, [list.length]);

  if (list.length === 0) return null;

  const current = list[index % list.length];

  return (
    <aside className={`${styles.bar} bg-purple-600 text-white`} aria-label="공지">
      <div className={styles.inner}>
        <div className={styles.track} aria-live="polite" aria-atomic="true">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current.id}
              className={styles.slide}
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '-100%', opacity: 0 }}
              transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link
                href={`/notices/${current.id}`}
                className={`${styles.title} ${styles.titleLink}`}
              >
                {current.title}
              </Link>
            </motion.div>
          </AnimatePresence>
        </div>
        <Link
          href="/notices"
          className={styles.allLink}
          aria-label="전체 공지 보기"
          title="전체보기"
        >
          <List size={20} strokeWidth={2} aria-hidden />
        </Link>
      </div>
    </aside>
  );
}
