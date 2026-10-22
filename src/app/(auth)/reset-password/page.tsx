'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import styles from './page.module.css';

type VerifyState = 'loading' | 'valid' | 'invalid';

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';

  const [verifyState, setVerifyState] = useState<VerifyState>(() => (token ? 'loading' : 'invalid'));
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/verify-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json()) as { valid?: boolean };
        if (cancelled) return;
        setVerifyState(data.valid ? 'valid' : 'invalid');
      } catch {
        if (!cancelled) setVerifyState('invalid');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (password !== passwordConfirm) {
      setMsg({ ok: false, text: '비밀번호가 일치하지 않습니다.' });
      return;
    }
    if (password.length < 6) {
      setMsg({ ok: false, text: '비밀번호는 6자 이상이어야 합니다.' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || '변경에 실패했습니다.');
      }
      setMsg({ ok: true, text: '비밀번호가 변경되었습니다. 로그인해 주세요.' });
      setPassword('');
      setPasswordConfirm('');
    } catch (err: unknown) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : '변경에 실패했습니다.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (verifyState === 'loading') {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.title}>비밀번호 재설정</h1>
          <p className={styles.lead}>링크를 확인하는 중입니다…</p>
        </div>
      </div>
    );
  }

  if (verifyState === 'invalid' && !msg?.ok) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.title}>비밀번호 재설정</h1>
          <p className={styles.err} role="alert">
            유효하지 않거나 만료된 링크입니다
          </p>
          <Link href="/" className={styles.btn}>
            메인으로 이동
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>비밀번호 재설정</h1>
        <p className={styles.lead}>새 비밀번호를 입력한 뒤 저장해 주세요.</p>
        {msg && <p className={msg.ok ? styles.ok : styles.err}>{msg.text}</p>}
        {msg?.ok ? (
          <Link href="/" className={styles.btn}>
            메인으로 이동
          </Link>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.label}>
              새 비밀번호
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </label>
            <label className={styles.label}>
              비밀번호 확인
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
                minLength={6}
              />
            </label>
            <button type="submit" className={styles.btn} disabled={submitting}>
              {submitting ? '저장 중…' : '비밀번호 저장'}
            </button>
          </form>
        )}
        {!msg?.ok && (
          <Link href="/" className={styles.link}>
            홈으로
          </Link>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.wrap}>
          <div className={styles.card}>
            <h1 className={styles.title}>비밀번호 재설정</h1>
            <p className={styles.lead}>불러오는 중…</p>
          </div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
