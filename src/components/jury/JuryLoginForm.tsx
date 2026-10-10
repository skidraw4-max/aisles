'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GoogleIcon } from '@/components/GoogleIcon';
import { signInWithOAuth } from '@/lib/capacitor-oauth';
import { getPublicSiteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/client';
import { syncPrismaUserWithAuth } from '@/lib/sync-prisma-user';
import { juryHref, juryOAuthRedirect, jurySignupHref, jurySignupLink, safeJuryNext } from '@/lib/jury-product/jury-url';
import styles from './jury-entry.module.css';

export function JuryLoginForm({ notice, returnQuery }: { notice?: string; returnQuery?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new Error('세션을 받지 못했습니다.');
      void syncPrismaUserWithAuth(data.session.access_token).catch((err: unknown) => {
        console.warn('[jury-auth] profile sync deferred failed:', err instanceof Error ? err.message : String(err));
      });
      router.push(returnQuery ? safeJuryNext(returnQuery) : juryHref('/'));
      router.refresh();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setMessage(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const callback = juryOAuthRedirect(getPublicSiteUrl(), returnQuery);
      if (!callback) throw new Error('Google 계정으로 진행할 수 없습니다.');
      await signInWithOAuth(supabase, 'google', {
        redirectTo: callback.redirectTo,
        queryParams: { prompt: 'select_account' },
      });
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Google 계정으로 진행할 수 없습니다.');
      setLoading(false);
    }
  };

  return (
    <section className={styles.screen}>
      <div className={styles.frame}>
        <h1 className={styles.brand}>AIsles Jury</h1>
        <h2 className={styles.loginTitle}>Sign in to your Jury workspace</h2>
        {notice ? <p className={styles.note} role="status">{notice}</p> : null}
        <form className={styles.form} onSubmit={handleLogin}>
          <label className={styles.field}>
            Email
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className={styles.field}>
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {message ? <p className={styles.alert} role="alert">{message}</p> : null}
          <button className={styles.primary} type="submit" disabled={loading}>
            Sign In
          </button>
          <p className={styles.divider}>또는</p>
          <button className={styles.google} type="button" onClick={() => void handleGoogle()} disabled={loading}>
            <GoogleIcon />
            Continue with Google
          </button>
        </form>
        <p className={styles.signup}>
          Don&apos;t have an account?{' '}
          <Link className={styles.textLink} href={returnQuery ? jurySignupLink(returnQuery) : jurySignupHref()}>
            Create account
          </Link>
        </p>
      </div>
    </section>
  );
}
