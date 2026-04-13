'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './profile.module.css';

type Props = {
  initialUsername: string;
  initialAvatarUrl: string | null;
  email: string;
};

export function ProfileForm({ initialUsername, initialAvatarUrl, email }: Props) {
  const [username, setUsername] = useState(initialUsername);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function getAccessToken(): Promise<string | null> {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function handleSaveNickname(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!username.trim()) {
      setMessage({ type: 'err', text: '닉네임을 입력해 주세요.' });
      return;
    }
    const token = await getAccessToken();
    if (!token) {
      setMessage({ type: 'err', text: '로그인이 필요합니다.' });
      return;
    }
    setNicknameSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: username.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; username?: string };
      if (!res.ok) {
        throw new Error(data.error || '저장에 실패했습니다.');
      }
      if (data.username) setUsername(data.username);
      setMessage({ type: 'ok', text: '닉네임이 저장되었습니다.' });
    } catch (err: unknown) {
      setMessage({ type: 'err', text: err instanceof Error ? err.message : '저장에 실패했습니다.' });
    } finally {
      setNicknameSaving(false);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMessage(null);
    const token = await getAccessToken();
    if (!token) {
      setMessage({ type: 'err', text: '로그인이 필요합니다.' });
      return;
    }
    setAvatarUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; avatarUrl?: string };
      if (!res.ok) {
        throw new Error(data.error || '이미지 업로드에 실패했습니다.');
      }
      if (data.avatarUrl) setAvatarUrl(data.avatarUrl);
      setMessage({ type: 'ok', text: '프로필 이미지가 업데이트되었습니다.' });
    } catch (err: unknown) {
      setMessage({ type: 'err', text: err instanceof Error ? err.message : '업로드에 실패했습니다.' });
    } finally {
      setAvatarUploading(false);
    }
  }

  return (
    <div className={styles.card}>
      {message && (
        <p className={message.type === 'ok' ? styles.msgOk : styles.msgErr} role="alert">
          {message.text}
        </p>
      )}

      <div className={styles.avatarBlock}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- R2 퍼블릭 도메인이 환경마다 달라 next/image 도메인 설정을 강제하지 않음
          <img className={styles.avatarPreview} src={avatarUrl} alt="" width={96} height={96} />
        ) : (
          <div className={styles.avatarPlaceholder}>이미지 없음</div>
        )}
        <div>
          <label className={styles.fileLabel}>
            <span className={styles.fileBtn}>{avatarUploading ? '업로드 중…' : '이미지 변경'}</span>
            <input
              className={styles.fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleAvatarChange}
              disabled={avatarUploading}
            />
          </label>
          <p className={styles.hint}>JPEG, PNG, WebP, GIF · 최대 5MB · Cloudflare R2에 저장됩니다.</p>
        </div>
      </div>

      <form className={styles.form} onSubmit={handleSaveNickname}>
        <label className={styles.label}>
          이메일
          <input className={styles.inputMuted} type="email" value={email} readOnly tabIndex={-1} />
        </label>
        <label className={styles.label}>
          닉네임
          <input
            className={styles.input}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(ev) => setUsername(ev.target.value)}
            minLength={2}
            maxLength={30}
            required
          />
        </label>
        <button type="submit" className={styles.primary} disabled={nicknameSaving}>
          {nicknameSaving ? '저장 중…' : '닉네임 저장'}
        </button>
      </form>
    </div>
  );
}
