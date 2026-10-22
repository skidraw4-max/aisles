'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { sendGAEvent } from '@/lib/ga4';
import styles from './post.module.css';

type Props = {
  postId: string;
  onPrefillComment?: (text: string) => void;
};

export function PostStanceStrip({ postId, onPrefillComment }: Props) {
  const [agree, setAgree] = useState(0);
  const [disagree, setDisagree] = useState(0);
  const [mine, setMine] = useState<'AGREE' | 'DISAGREE' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: HeadersInit = {};
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`/api/posts/${postId}/stance`, { headers });
      if (!res.ok) return;
      const data = (await res.json()) as {
        agree?: number;
        disagree?: number;
        mine?: 'AGREE' | 'DISAGREE' | null;
      };
      setAgree(data.agree ?? 0);
      setDisagree(data.disagree ?? 0);
      setMine(data.mine ?? null);
    } catch {
      // ignore
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function vote(choice: 'AGREE' | 'DISAGREE') {
    setError(null);
    setPending(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('로그인 후 의견을 표시할 수 있습니다.');
        return;
      }
      const res = await fetch(`/api/posts/${postId}/stance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ choice }),
      });
      const data = (await res.json()) as {
        error?: string;
        agree?: number;
        disagree?: number;
        mine?: 'AGREE' | 'DISAGREE';
      };
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setAgree(data.agree ?? 0);
      setDisagree(data.disagree ?? 0);
      setMine(data.mine ?? choice);
      sendGAEvent('stance_vote', { post_id: postId, choice });
      onPrefillComment?.(
        choice === 'AGREE' ? '동의합니다. ' : '다른 의견입니다. ',
      );
      document.getElementById('post-comments')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했습니다.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.stanceStrip} role="group" aria-label="동의·반박">
      <p className={styles.stancePrompt}>이 글에 대한 한 줄 의견</p>
      <div className={styles.stanceButtons}>
        <button
          type="button"
          className={mine === 'AGREE' ? styles.stanceBtnActive : styles.stanceBtn}
          disabled={pending}
          aria-pressed={mine === 'AGREE'}
          onClick={() => void vote('AGREE')}
        >
          동의 {agree > 0 ? `(${agree})` : ''}
        </button>
        <button
          type="button"
          className={mine === 'DISAGREE' ? styles.stanceBtnActive : styles.stanceBtn}
          disabled={pending}
          aria-pressed={mine === 'DISAGREE'}
          onClick={() => void vote('DISAGREE')}
        >
          반박 {disagree > 0 ? `(${disagree})` : ''}
        </button>
      </div>
      {error ? (
        <p className={styles.engagementErr} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
