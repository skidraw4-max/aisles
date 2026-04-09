'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './page.module.css';

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMsg({ ok: true, text: '비밀번호가 변경되었습니다. 로그인해 주세요.' });
      setPassword('');
    } catch (err: unknown) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : '변경에 실패했습니다. 링크가 만료되었을 수 있습니다.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>새 비밀번호 설정</h1>
        <p className={styles.lead}>이메일로 받은 링크로 들어온 뒤 새 비밀번호를 입력하세요.</p>
        {msg && <p className={msg.ok ? styles.ok : styles.err}>{msg.text}</p>}
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
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? '저장 중…' : '비밀번호 저장'}
          </button>
        </form>
        <Link href="/" className={styles.link}>
          홈으로
        </Link>
      </div>
    </div>
  );
}
