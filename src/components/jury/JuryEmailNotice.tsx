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
      setStatus('Verification email sent.');
    } catch {
      setError('Could not resend the verification email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.screen}>
      <div className={styles.frame}>
        <h1 className={styles.brand}>AIsles Jury</h1>
        <p className={styles.studio}>by AIsles Studio</p>
        <h2 className={styles.loginTitle}>Check your email</h2>
        <p className={styles.copy}>We sent a verification link to:</p>
        {shown ? <p className={styles.email}>{shown}</p> : null}
        <p className={styles.copy}>Please verify your email before continuing to AIsles Jury.</p>
        {status ? <p className={styles.note} role="status">{status}</p> : null}
        {error ? <p className={styles.alert} role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <Link className={styles.primary} href={juryHref('/login')}>
            Back to Sign In
          </Link>
        </div>
        <p className={styles.signup}>
          Didn&apos;t receive the email?{' '}
          <button className={styles.textButton} type="button" onClick={() => void resend()} disabled={!email || loading}>
            Resend verification email
          </button>
        </p>
      </div>
    </section>
  );
}
