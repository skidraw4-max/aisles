'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getPublicSiteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/client';
import { juryEmailVerificationDestination, juryHref } from '@/lib/jury-product/jury-url';
import { maskJuryEmail } from '@/lib/jury-product/jury-signup';
import styles from './jury-entry.module.css';

export function JuryEmailNotice({ email }: { email?: string | null }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const shown = email ? maskJuryEmail(email) : null;

  const resend = async () => {
    if (!email) return;
    setStatus(null);
    setError(null);
    setLoading(true);
    try {
      const destination = juryEmailVerificationDestination(getPublicSiteUrl());
      if (!destination) throw new Error('missing-destination');
      const { error: resendError } = await createClient().auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: destination },
      });
      if (resendError) throw new Error('resend-failed');
      setStatus('인증 메일을 보냈습니다.');
    } catch {
      setError('인증 메일을 다시 보내지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.screen}>
      <div className={styles.frame}>
        <h1 className={styles.brand}>AIsles Jury</h1>
        <p className={styles.studio}>by AIsles Studio</p>
        <h2 className={styles.loginTitle}>이메일을 확인하세요</h2>
        <p className={styles.copy}>인증 링크를 보낸 주소:</p>
        {shown ? <p className={styles.email}>{shown}</p> : null}
        <p className={styles.copy}>AIsles Jury를 계속 사용하려면 이메일을 인증해 주세요.</p>
        {status ? <p className={styles.note} role="status">{status}</p> : null}
        {error ? <p className={styles.alert} role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <Link className={styles.primary} href={juryHref('/login')}>
            로그인으로 돌아가기
          </Link>
        </div>
        <p className={styles.signup}>
          메일을 받지 못했나요?{' '}
          <button className={styles.textButton} type="button" onClick={() => void resend()} disabled={!email || loading}>
            인증 메일 다시 보내기
          </button>
        </p>
      </div>
    </section>
  );
}
