'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './post.module.css';

type Props = {
  postId: string;
  postTitle: string;
  /** 삭제 후 이동할 경로 (보통 해당 복도 홈) */
  afterDeleteHref: string;
};

export function PostOwnerActions({ postId, postTitle, afterDeleteHref }: Props) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeModal = useCallback(() => {
    if (deleting) return;
    setConfirmOpen(false);
    setError(null);
  }, [deleting]);

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmOpen, closeModal]);

  async function handleConfirmDelete() {
    setError(null);
    setDeleting(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('로그인이 필요합니다.');
        return;
      }
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || '삭제에 실패했습니다.');
        return;
      }
      setConfirmOpen(false);
      router.push(afterDeleteHref);
      router.refresh();
    } catch {
      setError('삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <nav className={styles.postOwnerActions} aria-label="내 게시글 관리">
        <Link href={`/upload?edit=${postId}`} className={styles.postOwnerBtnEdit}>
          수정
        </Link>
        <button
          type="button"
          className={styles.postOwnerBtnDelete}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
        >
          삭제
        </button>
      </nav>

      {confirmOpen ? (
        <div
          className={styles.postOwnerModalRoot}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className={styles.postOwnerModalPanel}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="post-owner-delete-title"
            aria-describedby="post-owner-delete-desc"
          >
            <h2 id="post-owner-delete-title" className={styles.postOwnerModalTitle}>
              게시글 삭제
            </h2>
            <p id="post-owner-delete-desc" className={styles.postOwnerModalText}>
              <span className={styles.postOwnerModalStrong}>「{postTitle}」</span>을(를) 삭제할까요? 삭제하면 댓글·좋아요
              등 관련 데이터도 함께 제거되며, 되돌릴 수 없습니다.
            </p>
            {error ? (
              <p className={styles.postOwnerModalErr} role="alert">
                {error}
              </p>
            ) : null}
            <div className={styles.postOwnerModalActions}>
              <button type="button" className={styles.postOwnerModalBtn} onClick={closeModal} disabled={deleting}>
                취소
              </button>
              <button
                type="button"
                className={styles.postOwnerModalBtnDanger}
                onClick={() => void handleConfirmDelete()}
                disabled={deleting}
              >
                {deleting ? '삭제 중…' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
