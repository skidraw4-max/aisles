'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { signInWithOAuth } from '@/lib/capacitor-oauth';
import { sendGAEvent } from '@/lib/ga4';
import { setRetentionWelcomePending } from '@/lib/retention-session';
import { getPublicSiteUrl } from '@/lib/site-url';
import { GoogleIcon } from '@/components/GoogleIcon';
import styles from './post-scroll-subscribe-modal.module.css';

const SESSION_SHOWN_KEY = 'aisle:post-scroll-subscribe-shown';
const PENDING_SUBSCRIBE_KEY = 'aisle:pending-news-subscribe';
/** 스크롤 60% → 45%: 본문 중반에 노출해 구독 전환 기회 확대 */
const SCROLL_THRESHOLD = 0.45;

type Props = {
  postId: string;
};

function buildOAuthCallbackUrl(): string {
  const base = getPublicSiteUrl().replace(/\/$/, '');
  const url = new URL('/auth/callback', `${base}/`);
  if (typeof window !== 'undefined') {
    const path = window.location.pathname + window.location.search;
    if (path.startsWith('/') && !path.startsWith('//')) {
      url.searchParams.set('next', path);
    }
  }
  return url.href;
}

async function subscribeNewsletter(token: string): Promise<boolean> {
  const res = await fetch('/api/news-subscription', {
    method: 'PATCH',
    cache: 'no-store',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subscribed: true, digestFrequency: 'DAILY' }),
  });
  return res.ok;
}

export function PostScrollSubscribeModal({ postId }: Props) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(true);
  const shownRef = useRef(false);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setIsLoggedIn(Boolean(session?.user?.id));
    })();
  }, []);

  const dismiss = useCallback(() => {
    sendGAEvent('digest_modal_dismiss', { post_id: postId });
    setVisible(false);
    try {
      sessionStorage.setItem(SESSION_SHOWN_KEY, '1');
    } catch {
      /* ignore */
    }
  }, [postId]);

  useEffect(() => {
    if (isLoggedIn) return;

    try {
      if (sessionStorage.getItem(SESSION_SHOWN_KEY) === '1') return;
    } catch {
      return;
    }

    const onScroll = () => {
      if (shownRef.current) return;
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop;
      const viewport = window.innerHeight;
      const total = Math.max(doc.scrollHeight - viewport, 1);
      const depth = scrollTop / total;
      if (depth >= SCROLL_THRESHOLD) {
        shownRef.current = true;
        setVisible(true);
        sendGAEvent('digest_modal_view', { post_id: postId });
        try {
          sessionStorage.setItem(SESSION_SHOWN_KEY, '1');
        } catch {
          /* ignore */
        }
        window.removeEventListener('scroll', onScroll);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [isLoggedIn, postId]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        if (sessionStorage.getItem(PENDING_SUBSCRIBE_KEY) !== '1') return;
      } catch {
        return;
      }
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token || cancelled) return;
      const ok = await subscribeNewsletter(token);
      if (ok) setRetentionWelcomePending('subscribe');
      try {
        sessionStorage.removeItem(PENDING_SUBSCRIBE_KEY);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  const handleGoogleSubscribe = async () => {
    sendGAEvent('digest_modal_subscribe', { post_id: postId });
    setError(null);
    setLoading(true);
    try {
      try {
        sessionStorage.setItem(PENDING_SUBSCRIBE_KEY, '1');
      } catch {
        /* ignore */
      }
      const supabase = createClient();
      await signInWithOAuth(supabase, 'google', {
        redirectTo: buildOAuthCallbackUrl(),
        queryParams: { prompt: 'select_account' },
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google 계정으로 진행할 수 없습니다.');
      setLoading(false);
    }
  };

  if (isLoggedIn || !visible) return null;

  return (
    <div
      className={`${styles.panel} ${styles.panelOpen}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="post-scroll-subscribe-title"
    >
      <div className={styles.head}>
        <h2 id="post-scroll-subscribe-title" className={styles.title}>
          매일 AI 핵심만, 3분 컷
        </h2>
        <button type="button" className={styles.close} onClick={dismiss} aria-label="닫기">
          ×
        </button>
      </div>
      <p className={styles.body}>
        LOUNGE 트렌드 요약을 메일로 받아보세요. Google로 로그인하면 바로 구독됩니다 — 광고성
        메일은 보내지 않습니다.
      </p>
      <button
        type="button"
        className={styles.googleBtn}
        onClick={() => void handleGoogleSubscribe()}
        disabled={loading}
      >
        <GoogleIcon />
        {loading ? '이동 중…' : 'Google로 무료 구독'}
      </button>
      {error ? (
        <p className={styles.msgErr} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
