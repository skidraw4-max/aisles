'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './profile.module.css';

export function WithdrawAccountSection() {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeModal = useCallback(() => {
    if (withdrawing) return;
    setConfirmOpen(false);
    setError(null);
  }, [withdrawing]);

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmOpen, closeModal]);

  async function handleConfirmWithdraw() {
    setError(null);
    setWithdrawing(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('로그인이 필요합니다.');
        return;
      }
      const res = await fetch('/api/account/withdraw', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || '탈퇴 처리에 실패했습니다.');
        return;
      }
      await supabase.auth.signOut();
      setConfirmOpen(false);
      router.push('/');
      router.refresh();
    } catch {
      setError('탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <>
      <section className={styles.withdrawSection} aria-labelledby="withdraw-heading">
        <h2 id="withdraw-heading" className={styles.withdrawTitle}>
          계정
        </h2>
        <p className={styles.withdrawLead}>
          탈퇴 시 프로필·작성 글·댓글·북마크 등 계정 데이터가 삭제되며 되돌릴 수 없습니다.
        </p>
        <button
          type="button"
          className={styles.withdrawBtn}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
        >
          탈퇴하기
        </button>
      </section>

      {confirmOpen ? (
        <div
          className={styles.withdrawModalRoot}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className={styles.withdrawModalPanel}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="withdraw-modal-title"
            aria-describedby="withdraw-modal-desc"
          >
            <h2 id="withdraw-modal-title" className={styles.withdrawModalTitle}>
              회원 탈퇴
            </h2>
            <p id="withdraw-modal-desc" className={styles.withdrawModalText}>
              정말 탈퇴하시겠습니까?
            </p>
            {error ? (
              <p className={styles.withdrawModalErr} role="alert">
                {error}
              </p>
            ) : null}
            <div className={styles.withdrawModalActions}>
              <button type="button" className={styles.withdrawModalBtn} onClick={closeModal} disabled={withdrawing}>
                취소
              </button>
              <button
                type="button"
                className={styles.withdrawModalBtnDanger}
                onClick={() => void handleConfirmWithdraw()}
                disabled={withdrawing}
              >
                {withdrawing ? '처리 중…' : '탈퇴하기'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
