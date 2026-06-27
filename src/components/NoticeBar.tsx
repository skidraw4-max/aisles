'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { List } from 'lucide-react';
import type { RollingNoticeDTO } from '@/app/notices/actions';
import { AppLaunchBarSlide } from '@/components/AppLaunchBanner';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import styles from './NoticeBar.module.css';

const APP_LAUNCH_SLIDE_ID = '__app_launch__';

type SlideItem =
  | { kind: 'app-launch'; id: typeof APP_LAUNCH_SLIDE_ID }
  | { kind: 'notice'; id: string; title: string };

type Props = {
  notices: RollingNoticeDTO[];
};

export function NoticeBar({ notices }: Props) {
  const [hideAppLaunch, setHideAppLaunch] = useState(true);

  useEffect(() => {
    setHideAppLaunch(isCapacitorNative());
  }, []);

  const list = useMemo(() => {
    const items: SlideItem[] = [];
    if (!hideAppLaunch) {
      items.push({ kind: 'app-launch', id: APP_LAUNCH_SLIDE_ID });
    }
    for (const n of notices) {
      const title = n.title?.trim();
      if (title) items.push({ kind: 'notice', id: n.id, title });
    }
    return items;
  }, [notices, hideAppLaunch]);

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [list.length, hideAppLaunch]);

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
  const isAppLaunch = current.kind === 'app-launch';

  return (
    <aside
      className={isAppLaunch ? styles.barAppLaunch : `${styles.bar} bg-purple-600 text-white`}
      aria-label={isAppLaunch ? 'Android 앱 출시 안내' : '공지'}
    >
      <div className={isAppLaunch ? styles.innerAppLaunch : styles.inner}>
        <div
          className={isAppLaunch ? styles.trackAppLaunch : styles.track}
          aria-live="polite"
          aria-atomic="true"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current.id}
              className={isAppLaunch ? styles.slideAppLaunch : styles.slide}
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '-100%', opacity: 0 }}
              transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
            >
              {isAppLaunch ? (
                <AppLaunchBarSlide />
              ) : (
                <Link
                  href={`/notices/${current.id}`}
                  className={`${styles.title} ${styles.titleLink}`}
                >
                  {current.title}
                </Link>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        {!isAppLaunch ? (
          <Link
            href="/notices"
            className={styles.allLink}
            aria-label="전체 공지 보기"
            title="전체보기"
          >
            <List size={20} strokeWidth={2} aria-hidden />
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
