'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MBTI_TYPES, type MbtiType } from '@/lib/ai-fortune/mbti';
import styles from './profile.module.css';

type Props = {
  initialMbti: MbtiType | null;
};

export function MbtiSelectSection({ initialMbti }: Props) {
  const [mbti, setMbti] = useState<MbtiType | ''>(initialMbti ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function getAccessToken(): Promise<string | null> {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!mbti) {
      setMessage({ type: 'err', text: 'MBTI 유형을 선택해 주세요.' });
      return;
    }
    const token = await getAccessToken();
    if (!token) {
      setMessage({ type: 'err', text: '로그인이 필요합니다.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/profile/mbti', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mbti }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; mbti?: MbtiType };
      if (!res.ok) {
        throw new Error(data.error || '저장에 실패했습니다.');
      }
      if (data.mbti) setMbti(data.mbti);
      setMessage({ type: 'ok', text: 'MBTI가 저장되었습니다. AI FORTUNE 리포트에서 내 유형 카드가 강조됩니다.' });
    } catch (err: unknown) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : '저장에 실패했습니다.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.mbtiSection} aria-labelledby="profile-mbti-heading">
      <h2 id="profile-mbti-heading" className={styles.mbtiTitle}>
        MBTI
      </h2>
      <p className={styles.mbtiLead}>
        AI FORTUNE 주간 운세에서 내 유형 카드가 네온 그린 테두리로 강조됩니다. 언제든 변경할 수
        있습니다.
      </p>
      {message && (
        <p className={message.type === 'ok' ? styles.msgOk : styles.msgErr} role="alert">
          {message.text}
        </p>
      )}
      <form className={styles.mbtiForm} onSubmit={handleSave}>
        <label className={styles.mbtiLabel}>
          유형 선택
          <select
            className={styles.mbtiSelect}
            value={mbti}
            onChange={(ev) => setMbti(ev.target.value as MbtiType | '')}
            required
          >
            <option value="" disabled>
              선택…
            </option>
            {MBTI_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={styles.mbtiSubmit} disabled={saving || !mbti}>
          {saving ? '저장 중…' : 'MBTI 저장'}
        </button>
      </form>
    </section>
  );
}
