'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getPublicSiteUrl } from '@/lib/site-url';
import { syncPrismaUserWithAuth } from '@/lib/sync-prisma-user';
import styles from './AuthModal.module.css';

const EMAIL_FIELD_HINT =
  '차후 알림 및 비밀번호 찾기등을 사용하시려면 유효한 이메일을 입력해 주세요.';

type Mode = 'login' | 'signup' | 'forgot';

type Props = {
  open: boolean;
  onClose: () => void;
  onAuthed: () => void;
  /** 로그인 페이지 URL 쿼리 등에서 넘기는 초기 안내 */
  initialNotice?: { type: 'ok' | 'err'; text: string } | null;
};

export function AuthModal({ open, onClose, onAuthed, initialNotice = null }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (open && initialNotice) setMessage(initialNotice);
  }, [open, initialNotice]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const resetFeedback = () => setMessage(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    resetFeedback();
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new Error('세션을 받지 못했습니다.');
      await syncPrismaUserWithAuth(data.session.access_token);
      onAuthed();
      onClose();
    } catch (err: unknown) {
      setMessage({ type: 'err', text: err instanceof Error ? err.message : '로그인에 실패했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    resetFeedback();
    if (!username.trim()) {
      setMessage({ type: 'err', text: '닉네임을 입력해 주세요.' });
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const site = getPublicSiteUrl();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username: username.trim() },
          ...(site ? { emailRedirectTo: `${site}/auth/callback` } : {}),
        },
      });
      if (error) throw error;
      if (data.session) {
        await syncPrismaUserWithAuth(data.session.access_token);
        onAuthed();
        onClose();
        return;
      }
      setMessage({
        type: 'ok',
        text: '가입이 접수되었습니다. 로그인 화면에서 이메일과 비밀번호로 로그인해 주세요.',
      });
    } catch (err: unknown) {
      setMessage({ type: 'err', text: err instanceof Error ? err.message : '회원가입에 실패했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  /** Supabase `resetPasswordForEmail`: 입력한 이메일로만 복구 메일 발송(존재 여부는 응답에 드러내지 않는 것이 권장). */
  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    resetFeedback();
    setLoading(true);
    try {
      const supabase = createClient();
      const site = getPublicSiteUrl();
      // PKCE 코드 교환은 /auth/callback 에서만 처리됨. /auth/update-password 로 직접내면
      // Supabase 허용 URL 누락 시 Site URL 루트(?code=)로 떨어져 홈에서 오류가 날 수 있음.
      const redirectTo = `${site}/auth/callback?next=${encodeURIComponent('/auth/update-password')}`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      if (error) throw error;
      setMessage({
        type: 'ok',
        text: '입력하신 이메일로 비밀번호 변경 링크를 보냈습니다. 메일함(스팸함)을 확인한 뒤 링크를 눌러 새 비밀번호를 설정해 주세요.',
      });
    } catch (err: unknown) {
      setMessage({ type: 'err', text: err instanceof Error ? err.message : '요청에 실패했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 id="auth-modal-title" className={styles.title}>
            {mode === 'login' && '로그인'}
            {mode === 'signup' && '회원가입'}
            {mode === 'forgot' && '비밀번호 찾기'}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {mode !== 'forgot' && (
          <div className={styles.tabs}>
            <button
              type="button"
              className={mode === 'login' ? styles.tabActive : styles.tab}
              onClick={() => {
                setMode('login');
                resetFeedback();
              }}
            >
              로그인
            </button>
            <button
              type="button"
              className={mode === 'signup' ? styles.tabActive : styles.tab}
              onClick={() => {
                setMode('signup');
                resetFeedback();
              }}
            >
              회원가입
            </button>
          </div>
        )}

        {message && (
          <p className={message.type === 'ok' ? styles.msgOk : styles.msgErr}>{message.text}</p>
        )}

        {mode === 'login' && (
          <form className={styles.form} onSubmit={handleLogin}>
            <label className={styles.label} htmlFor="auth-login-email">
              이메일
              <input
                id="auth-login-email"
                className={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-describedby="auth-login-email-hint"
              />
            </label>
            <p id="auth-login-email-hint" className={styles.emailHint}>
              {EMAIL_FIELD_HINT}
            </p>
            <label className={styles.label} htmlFor="auth-login-password">
              비밀번호
              <input
                id="auth-login-password"
                className={styles.input}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button type="button" className={styles.linkBtn} onClick={() => setMode('forgot')}>
              비밀번호를 잊으셨나요?
            </button>
            <button type="submit" className={styles.primary} disabled={loading}>
              {loading ? '처리 중…' : '로그인'}
            </button>
          </form>
        )}

        {mode === 'signup' && (
          <form className={styles.form} onSubmit={handleSignup}>
            <label className={styles.label} htmlFor="auth-signup-username">
              닉네임
              <input
                id="auth-signup-username"
                className={styles.input}
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={2}
                maxLength={30}
              />
            </label>
            <label className={styles.label} htmlFor="auth-signup-email">
              이메일
              <input
                id="auth-signup-email"
                className={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-describedby="auth-signup-email-hint"
              />
            </label>
            <p id="auth-signup-email-hint" className={styles.emailHint}>
              {EMAIL_FIELD_HINT}
            </p>
            <label className={styles.label} htmlFor="auth-signup-password">
              비밀번호
              <input
                id="auth-signup-password"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </label>
            <button type="submit" className={styles.primary} disabled={loading}>
              {loading ? '처리 중…' : '가입하기'}
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form className={styles.form} onSubmit={handleForgot}>
            <p className={styles.hint}>
              가입 시 사용한 이메일을 입력해 주세요. 해당 주소로만 비밀번호 변경 링크가 전송되며, 메일에 있는
              링크를 누르면 새 비밀번호를 설정할 수 있습니다.
            </p>
            <label className={styles.label} htmlFor="auth-forgot-email">
              이메일
              <input
                id="auth-forgot-email"
                className={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-describedby="auth-forgot-email-hint"
              />
            </label>
            <p id="auth-forgot-email-hint" className={styles.emailHint}>
              {EMAIL_FIELD_HINT}
            </p>
            <button type="submit" className={styles.primary} disabled={loading}>
              {loading ? '전송 중…' : '비밀번호 변경 링크 보내기'}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setMode('login');
                resetFeedback();
              }}
            >
              로그인으로 돌아가기
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
