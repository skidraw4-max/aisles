'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GoogleIcon } from '@/components/GoogleIcon';
import { signInWithOAuth } from '@/lib/capacitor-oauth';
import { getAuthCallbackSiteUrl, getPublicSiteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/client';
import { syncPrismaUserWithAuth } from '@/lib/sync-prisma-user';
import { ACCOUNT_EMAIL_CONFLICT_MESSAGE, runProfileSync } from '@/lib/auth/account-email-conflict';
import {
  classifyJurySignUpResult,
  juryAuthErrorMessage,
  jurySignupIssueMessage,
  validateJurySignup,
} from '@/lib/jury-product/jury-signup';
import { JuryUserManualLinks } from '@/components/jury/JuryUserManualLinks';
import { juryEmailVerificationDestination, juryHref, juryOAuthRedirect, safeJuryNext } from '@/lib/jury-product/jury-url';
import { JuryEmailNotice } from './JuryEmailNotice';
import styles from './jury-entry.module.css';

const GENERIC = '계정을 만들 수 없어요. 다시 시도해 주세요.';

export function JurySignupForm({ returnQuery }: { returnQuery?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const issue = validateJurySignup({ email, password, confirmPassword });
    if (issue) {
      setMessage(jurySignupIssueMessage(issue));
      return;
    }
    setLoading(true);
    try {
      const destination = juryEmailVerificationDestination(getPublicSiteUrl(), returnQuery);
      if (!destination) {
        setMessage(GENERIC);
        return;
      }
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: destination },
      });
      const outcome = classifyJurySignUpResult({
        errorMessage: error?.message,
        user: data.user,
        session: data.session,
      });
      if (outcome === 'existing') {
        setMessage('이미 가입된 이메일이에요. 로그인해 주세요.');
        return;
      }
      if (outcome === 'enter' && data.session?.access_token) {
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
        return;
      }
      if (outcome === 'verify') {
        setPendingEmail(email.trim());
        return;
      }
      setMessage(juryAuthErrorMessage(error?.message));
    } catch {
      setMessage(GENERIC);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setMessage(null);
    setLoading(true);
    try {
      const callback = juryOAuthRedirect(getAuthCallbackSiteUrl(), returnQuery);
      if (!callback) throw new Error('missing-callback');
      await signInWithOAuth(createClient(), 'google', {
        redirectTo: callback.redirectTo,
        queryParams: { prompt: 'select_account' },
      });
    } catch {
      setMessage('Google 계정으로 진행할 수 없어요.');
      setLoading(false);
    }
  };

  if (pendingEmail) return <JuryEmailNotice email={pendingEmail} />;

  return (
    <section className={styles.screen}>
      <div className={styles.frame}>
        <h1 className={styles.brand}>AIsles Jury</h1>
        <p className={styles.studio}>by AIsles Studio</p>
        <h2 className={styles.loginTitle}>Jury 계정 만들기</h2>
        <form className={styles.form} onSubmit={handleSignup}>
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
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label className={styles.field}>
            비밀번호 확인
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </label>
          {message ? <p className={styles.alert} role="alert">{message}</p> : null}
          <button className={styles.primary} type="submit" disabled={loading}>
            계정 만들기
          </button>
          <p className={styles.divider}>또는</p>
          <button className={styles.google} type="button" onClick={() => void handleGoogle()} disabled={loading}>
            <GoogleIcon />
            Google로 계속하기
          </button>
        </form>
        <p className={styles.signup}>
          이미 계정이 있나요?{' '}
          <Link className={styles.textLink} href={juryHref('/login')}>
            로그인
          </Link>
        </p>
        <JuryUserManualLinks variant="auth" />
      </div>
    </section>
  );
}
