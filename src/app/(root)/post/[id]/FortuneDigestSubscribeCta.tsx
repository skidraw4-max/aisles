'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { sendGAEvent } from '@/lib/ga4';
import { getPublicSiteUrl } from '@/lib/site-url';
import { setRetentionWelcomePending } from '@/lib/retention-session';
import styles from './fortune-digest-subscribe-cta.module.css';

const PENDING_SUBSCRIBE_KEY = 'aisle:pending-news-subscribe';

type Props = {
  postId: string;
  isLoggedIn: boolean;
  newsletterSubscribed: boolean;
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

export function FortuneDigestSubscribeCta({ postId, isLoggedIn, newsletterSubscribed }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewSentRef = useRef(false);

  useEffect(() => {
    if (newsletterSubscribed || viewSentRef.current) return;
    viewSentRef.current = true;
    sendGAEvent('fortune_digest_cta_view', { post_id: postId });
  }, [newsletterSubscribed, postId]);

  useEffect(() => {
    if (!isLoggedIn || newsletterSubscribed) return;
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
  }, [isLoggedIn, newsletterSubscribed]);

  const handleGoogleSubscribe = useCallback(async () => {
    sendGAEvent('fortune_subscribe_cta_click', { post_id: postId });
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
  }, [postId]);

  if (newsletterSubscribed) return null;

  return (
    <section className={styles.wrap} aria-labelledby="fortune-digest-cta-title">
      <h2 id="fortune-digest-cta-title" className={styles.title}>
        📬 AI 트렌드 다이제스트 구독
      </h2>
      <p className={styles.body}>
        LOUNGE 핵심 요약과 함께, 매주 AI FORTUNE 주간 리포트 소식도 메일로 받아보세요. Google 계정으로
        3초 만에 구독할 수 있습니다.
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
    </section>
  );
}
