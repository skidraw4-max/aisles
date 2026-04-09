'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getPublicSiteUrl } from '@/lib/site-url';
import { syncPrismaUserWithAuth } from '@/lib/sync-prisma-user';
import styles from './AuthModal.module.css';

type Mode = 'login' | 'signup' | 'forgot';

type Props = {
  open: boolean;
  onClose: () => void;
  onAuthed: () => void;
};

export function AuthModal({ open, onClose, onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

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
      if (!data.session) {
        setMessage({
          type: 'ok',
          text:
            'Supabase Auth에 가입되었습니다. 이메일 인증 후 첫 로그인 시 Prisma 프로필도 자동으로 만들어집니다. (대시보드에서 이메일 확인을 끄면 바로 로그인·동기화됩니다.)',
        });
        return;
      }
      await syncPrismaUserWithAuth(data.session.access_token);
      onAuthed();
      onClose();
    } catch (err: unknown) {
      setMessage({ type: 'err', text: err instanceof Error ? err.message : '회원가입에 실패했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    resetFeedback();
    setLoading(true);
    try {
      const supabase = createClient();
      const site = getPublicSiteUrl();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: site ? `${site}/auth/update-password` : `${window.location.origin}/auth/update-password`,
      });
      if (error) throw error;
      setMessage({
        type: 'ok',
        text: '비밀번호 재설정 링크를 이메일로 보냈습니다. 메일함을 확인해 주세요.',
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
            <label className={styles.label}>
              이메일
              <input
                className={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className={styles.label}>
              비밀번호
              <input
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
            <label className={styles.label}>
              닉네임
              <input
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
            <label className={styles.label}>
              이메일
              <input
                className={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className={styles.label}>
              비밀번호
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
            <button type="submit" className={styles.primary} disabled={loading}>
              {loading ? '처리 중…' : '가입하기'}
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form className={styles.form} onSubmit={handleForgot}>
            <p className={styles.hint}>가입 시 사용한 이메일로 재설정 링크를 보냅니다.</p>
            <label className={styles.label}>
              이메일
              <input
                className={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <button type="submit" className={styles.primary} disabled={loading}>
              {loading ? '전송 중…' : '재설정 메일 보내기'}
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
