'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sendGAEvent } from '@/lib/ga4';
import { tryCreateBrowserClient } from '@/lib/supabase/client';
import {
  clearRetentionWelcomePending,
  peekRetentionWelcomeReason,
  type RetentionWelcomeReason,
} from '@/lib/retention-session';
import styles from './retention-welcome-toast.module.css';

const AUTO_DISMISS_MS = 6000;

type Props = {
  latestFortunePostId: string | null;
};

function welcomeCopy(reason: RetentionWelcomeReason): string {
  if (reason === 'subscribe') {
    return 'AI 트렌드 다이제스트 구독이 완료되었습니다. 환영합니다!';
  }
  return '저장한 북마크가 내 계정에 반영되었습니다.';
}

export function RetentionWelcomeToast({ latestFortunePostId }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RetentionWelcomeReason | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pending = peekRetentionWelcomeReason();
      if (!pending) return;

      const supabase = tryCreateBrowserClient();
      if (!supabase) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token || cancelled) return;

      setReason(pending);
      setOpen(true);
      clearRetentionWelcomePending();
      sendGAEvent('retention_welcome_shown', { reason: pending });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setOpen(false), AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open || !reason) return null;

  return (
    <div className={`${styles.wrap} ${styles.open}`} role="status" aria-live="polite">
      <button
        type="button"
        className={styles.close}
        onClick={() => setOpen(false)}
        aria-label="닫기"
      >
        ×
      </button>
      <p className={styles.text}>{welcomeCopy(reason)}</p>
      <div className={styles.links}>
        <Link href="/my-aisles" className={styles.link} onClick={() => setOpen(false)}>
          My Aisles
        </Link>
        {latestFortunePostId ? (
          <Link
            href={`/post/${latestFortunePostId}`}
            className={styles.link}
            onClick={() => setOpen(false)}
          >
            이번 주 AI FORTUNE
          </Link>
        ) : (
          <Link href="/?category=AI_FORTUNE" className={styles.link} onClick={() => setOpen(false)}>
            AI FORTUNE
          </Link>
        )}
      </div>
    </div>
  );
}
