'use client';

import {
  formatSupabaseAuthErrorDescription,
  isSupabaseAuthLinkError,
} from '@/lib/supabase-auth-url-errors';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './HomeSupabaseRedirectHandler.module.css';

function mergeSearchAndHash(search: string, hash: string): URLSearchParams {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const h = new URLSearchParams(fragment);
  const merged = new URLSearchParams(q.toString());
  for (const [k, v] of h.entries()) {
    if (!merged.has(k)) merged.set(k, v);
  }
  return merged;
}

/**
 * 홈(/)에서만: (1) 만료·무효 링크 쿼리/해시 → 안내 + URL 정리 (2) PKCE code만 있으면 reset-callback으로 이동.
 */
export function HomeSupabaseRedirectHandler() {
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    const { pathname, search, hash } = window.location;
    if (pathname !== '/') return;

    const merged = mergeSearchAndHash(search, hash);

    if (isSupabaseAuthLinkError(merged)) {
      const qOnly = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      const hasQueryError = qOnly.has('error_code') || qOnly.has('error');
      if (!hasQueryError) {
        setBanner(formatSupabaseAuthErrorDescription(merged.get('error_description')));
      }
      window.history.replaceState(null, '', `${window.location.origin}/`);
      return;
    }

    const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    if (q.has('code')) {
      window.location.replace(`/auth/reset-callback${search}`);
    }
  }, []);

  if (!banner) return null;

  return (
    <div className={styles.banner} role="alert">
      <p className={styles.bannerTitle}>{banner}</p>
      <p className={styles.bannerHint}>
        비밀번호 재설정이 필요하면{' '}
        <Link href="/login" className={styles.bannerLink}>
          로그인
        </Link>{' '}
        화면에서 다시 요청해 주세요.
      </p>
    </div>
  );
}
