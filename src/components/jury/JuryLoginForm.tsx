'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GoogleIcon } from '@/components/GoogleIcon';
import { signInWithOAuth } from '@/lib/capacitor-oauth';
import { getAuthCallbackSiteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/client';
import { syncPrismaUserWithAuth } from '@/lib/sync-prisma-user';
import { ACCOUNT_EMAIL_CONFLICT_MESSAGE, runProfileSync } from '@/lib/auth/account-email-conflict';
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
      const syncOutcome = await runProfileSync(
        syncPrismaUserWithAuth,
        data.session.access_token,
        undefined,
        '[jury-auth] profile sync deferred failed:',
      );
      if (syncOutcome === 'conflict') {
        setMessage(ACCOUNT_EMAIL_CONFLICT_MESSAGE);
        return;
      }
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
      const callback = juryOAuthRedirect(getAuthCallbackSiteUrl(), returnQuery);
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
        <h2 className={styles.loginTitle}>Jury 작업 공간에 로그인</h2>
        {notice ? <p className={styles.note} role="status">{notice}</p> : null}
        <form className={styles.form} onSubmit={handleLogin}>
          <label className={styles.field}>
            이메일
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
            비밀번호
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
            로그인
          </button>
          <p className={styles.divider}>또는</p>
          <button className={styles.google} type="button" onClick={() => void handleGoogle()} disabled={loading}>
            <GoogleIcon />
            Google로 계속하기
          </button>
        </form>
        <p className={styles.signup}>
          계정이 없나요?{' '}
          <Link className={styles.textLink} href={returnQuery ? jurySignupLink(returnQuery) : jurySignupHref()}>
            계정 만들기
          </Link>
        </p>
      </div>
    </section>
  );
}
