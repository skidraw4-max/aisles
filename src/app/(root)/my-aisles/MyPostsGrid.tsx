'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { MediaThumb } from '@/components/MediaThumb';
import { POST_CATEGORY_OPTIONS } from '@/lib/post-categories';
import type { Category } from '@prisma/client';
import styles from './my-aisles.module.css';

export type MyPostRow = {
  id: string;
  title: string;
  category: Category;
  thumbnail: string | null;
  createdAt: string;
  views: number;
  likeCount: number;
  authorUsername: string;
};

function categoryLabel(c: Category) {
  return POST_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function MyAislesLoungeGossipList({
  posts,
  onDeleteClick,
}: {
  posts: MyPostRow[];
  onDeleteClick: (id: string) => void;
}) {
  if (posts.length === 0) return null;
  return (
    <section className={styles.textListSection} aria-labelledby="my-aisles-lg-heading">
      <h2 id="my-aisles-lg-heading" className={styles.textListHeading}>
        Lounge · Gossip
      </h2>
      <div className={styles.textListSurface}>
        <div className={styles.textListHead} role="row">
          <span className={styles.textListColTitle} role="columnheader">
            제목
          </span>
          <span className={styles.textListColDate} role="columnheader">
            작성일
          </span>
          <span className={styles.textListColAuthor} role="columnheader">
            작성자
          </span>
          <span className={styles.textListColActions} role="columnheader">
            관리
          </span>
        </div>
        <ul className={styles.textListUl} role="list">
          {posts.map((post) => (
            <li key={post.id} className={styles.textListLi}>
              <div className={styles.textListRow}>
                <Link href={`/post/${post.id}`} className={styles.textListMainLink}>
                  <span className={styles.textListTitleStr}>{post.title}</span>
                  <span className={styles.textListDate}>{formatDate(post.createdAt)}</span>
                  <span className={styles.textListAuthor} title={post.authorUsername}>
                    {post.authorUsername}
                  </span>
                </Link>
                <div className={styles.textListActions}>
                  <Link href={`/post/${post.id}`} className={styles.textListMiniBtn}>
                    보기
                  </Link>
                  <Link href={`/upload?edit=${post.id}`} className={styles.textListMiniBtn}>
                    수정
                  </Link>
                  <button
                    type="button"
                    className={`${styles.textListMiniBtn} ${styles.textListMiniBtnDanger}`}
                    onClick={() => onDeleteClick(post.id)}
                  >
                    삭제
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function MyPostsGrid({ posts }: { posts: MyPostRow[] }) {
  const router = useRouter();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loungeGossipPosts = posts.filter((p) => p.category === 'LOUNGE' || p.category === 'GOSSIP');
  const cardPosts = posts.filter((p) => p.category !== 'LOUNGE' && p.category !== 'GOSSIP');

  const confirmPost = confirmId ? posts.find((p) => p.id === confirmId) : undefined;

  function openDelete(id: string) {
    setDeleteError(null);
    setConfirmId(id);
  }

  const closeModal = useCallback(() => {
    if (deleting) return;
    setConfirmId(null);
    setDeleteError(null);
  }, [deleting]);

  useEffect(() => {
    if (!confirmId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmId, closeModal]);

  async function handleConfirmDelete() {
    if (!confirmId) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setDeleteError('로그인이 필요합니다.');
        return;
      }
      const res = await fetch(`/api/posts/${confirmId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDeleteError(data.error || '삭제에 실패했습니다.');
        return;
      }
      setConfirmId(null);
      router.refresh();
    } catch {
      setDeleteError('삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
    }
  }

  if (posts.length === 0) {
    return (
      <p className={styles.empty}>
        아직 작성한 게시글이 없습니다.{' '}
        <Link href="/upload">업로드</Link>에서 첫 글을 올려 보세요.
      </p>
    );
  }

  return (
    <>
      <MyAislesLoungeGossipList posts={loungeGossipPosts} onDeleteClick={openDelete} />
      {cardPosts.length > 0 ? (
        <ul className={styles.grid}>
          {cardPosts.map((post) => (
            <li key={post.id}>
              <article className={styles.card}>
                <Link href={`/post/${post.id}`} className={styles.cardMedia} aria-label={`${post.title} 상세`}>
                  {post.thumbnail ? (
                    <MediaThumb url={post.thumbnail} alt="" objectFit="cover" />
                  ) : (
                    <div className={styles.placeholder} aria-hidden />
                  )}
                  <span className={styles.badge}>{categoryLabel(post.category)}</span>
                </Link>
                <div className={styles.cardBody}>
                  <h2 className={styles.cardTitle}>{post.title}</h2>
                  <p className={styles.cardMeta}>
                    {formatDate(post.createdAt)} · 조회 {post.views} · ♥ {post.likeCount}
                  </p>
                  <div className={styles.actions}>
                    <Link href={`/post/${post.id}`} className={`${styles.btnBase} ${styles.linkView}`}>
                      보기
                    </Link>
                    <Link href={`/upload?edit=${post.id}`} className={`${styles.btnBase} ${styles.btnEdit}`}>
                      수정
                    </Link>
                    <button
                      type="button"
                      className={`${styles.btnBase} ${styles.btnDelete}`}
                      onClick={() => openDelete(post.id)}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : null}

      {confirmPost ? (
        <div
          className={styles.modalRoot}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className={styles.modalPanel}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-desc"
          >
            <h2 id="delete-dialog-title" className={styles.modalTitle}>
              게시글 삭제
            </h2>
            <p id="delete-dialog-desc" className={styles.modalText}>
              <span className={styles.modalStrong}>「{confirmPost.title}」</span>을(를) 삭제할까요? 삭제하면
              댓글·좋아요 등 관련 데이터도 함께 제거되며, 되돌릴 수 없습니다.
            </p>
            {deleteError ? (
              <p className={styles.errBanner} role="alert">
                {deleteError}
              </p>
            ) : null}
            <div className={styles.modalActions}>
              <button type="button" className={styles.modalBtn} onClick={closeModal} disabled={deleting}>
                취소
              </button>
              <button
                type="button"
                className={styles.modalBtnDanger}
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
