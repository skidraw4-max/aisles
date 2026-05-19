'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getPublicSiteUrl } from '@/lib/site-url';
import styles from './post-scroll-subscribe-modal.module.css';

const SESSION_SHOWN_KEY = 'aisle:post-scroll-subscribe-shown';
const PENDING_SUBSCRIBE_KEY = 'aisle:pending-news-subscribe';
const SCROLL_THRESHOLD = 0.6;

type Props = {
  isLoggedIn: boolean;
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

export function PostScrollSubscribeModal({ isLoggedIn }: Props) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownRef = useRef(false);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      sessionStorage.setItem(SESSION_SHOWN_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

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
  }, [isLoggedIn]);

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
      await subscribeNewsletter(token);
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
    setError(null);
    setLoading(true);
    try {
      try {
        sessionStorage.setItem(PENDING_SUBSCRIBE_KEY, '1');
      } catch {
        /* ignore */
      }
      const supabase = createClient();
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: buildOAuthCallbackUrl(),
          queryParams: { prompt: 'select_account' },
        },
      });
      if (oauthError) throw oauthError;
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      throw new Error('Google 로그인 URL을 받지 못했습니다.');
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
          AI 트렌드 다이제스트
        </h2>
        <button type="button" className={styles.close} onClick={dismiss} aria-label="닫기">
          ×
        </button>
      </div>
      <p className={styles.body}>
        바쁜 일상 속 최신 AI 핵심 요약, 놓치지 마세요! 📬 매주 전달되는 AI 트렌드 다이제스트를
        메일로 받아보세요.
      </p>
      <button
        type="button"
        className={styles.googleBtn}
        onClick={() => void handleGoogleSubscribe()}
        disabled={loading}
      >
        {loading ? '이동 중…' : '구글 아이디로 3초 만에 구독하기'}
      </button>
      {error ? (
        <p className={styles.msgErr} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
