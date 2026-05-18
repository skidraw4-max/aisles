'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MBTI_TYPES } from '@/lib/ai-fortune/mbti';
import styles from './my-aisles.module.css';

type Props = {
  initialMbti: string | null;
};

export function MbtiSection({ initialMbti }: Props) {
  const [mbti, setMbti] = useState<string | null>(initialMbti);
  const [selected, setSelected] = useState(initialMbti ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const locked = Boolean(mbti);

  async function getAccessToken(): Promise<string | null> {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (locked) return;
    setMessage(null);
    if (!selected) {
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
        body: JSON.stringify({ mbti: selected }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; mbti?: string };
      if (!res.ok) {
        throw new Error(data.error || '저장에 실패했습니다.');
      }
      if (data.mbti) {
        setMbti(data.mbti);
        setSelected(data.mbti);
      }
      setMessage({ type: 'ok', text: 'MBTI가 저장되었습니다. 이후에는 변경할 수 없습니다.' });
    } catch (err: unknown) {
      setMessage({ type: 'err', text: err instanceof Error ? err.message : '저장에 실패했습니다.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.mbtiCard} aria-labelledby="my-aisles-mbti-title">
      <h2 id="my-aisles-mbti-title" className={styles.mbtiTitle}>
        MBTI (최초 1회)
      </h2>
      <p className={styles.mbtiLead}>
        AI FORTUNE 맞춤 운세를 위해 MBTI를 등록합니다. 한 번 저장하면 변경할 수 없습니다.
      </p>
      {message ? (
        <p className={message.type === 'ok' ? styles.mbtiMsgOk : styles.mbtiMsgErr} role="alert">
          {message.text}
        </p>
      ) : null}
      {locked ? (
        <p className={styles.mbtiSaved}>
          저장된 유형: <strong>{mbti}</strong>
        </p>
      ) : (
        <form className={styles.mbtiForm} onSubmit={(e) => void handleSave(e)}>
          <label className={styles.mbtiLabel} htmlFor="mbti-select">
            유형 선택
          </label>
          <select
            id="mbti-select"
            className={styles.mbtiSelect}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={saving}
          >
            <option value="">선택…</option>
            {MBTI_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button type="submit" className={styles.mbtiSubmit} disabled={saving || !selected}>
            {saving ? '저장 중…' : 'MBTI 저장'}
          </button>
        </form>
      )}
    </section>
  );
}
