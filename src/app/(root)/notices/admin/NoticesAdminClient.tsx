'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createNoticeAdminAction,
  deleteNoticeAdminAction,
  updateNoticeAdminAction,
} from '@/app/notices/actions';
import styles from './admin.module.css';

export type NoticeAdminRow = {
  id: string;
  title: string;
  content: string;
  link: string | null;
  isRolling: boolean;
  priority: number;
  createdAt: string;
};

type Props = { initialNotices: NoticeAdminRow[] };

export function NoticesAdminClient({ initialNotices }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initialNotices);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [link, setLink] = useState('');
  const [isRolling, setIsRolling] = useState(false);
  const [priority, setPriority] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setItems(initialNotices);
  }, [initialNotices]);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setContent('');
    setLink('');
    setIsRolling(false);
    setPriority(0);
    setError(null);
  };

  const loadIntoForm = (n: NoticeAdminRow) => {
    setEditingId(n.id);
    setTitle(n.title);
    setContent(n.content ?? '');
    setLink(n.link ?? '');
    setIsRolling(n.isRolling);
    setPriority(n.priority);
    setError(null);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      if (editingId) {
        const res = await updateNoticeAdminAction({
          id: editingId,
          title,
          content,
          link: link.trim() ? link.trim() : null,
          isRolling,
          priority,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
      } else {
        const res = await createNoticeAdminAction({
          title,
          content,
          link: link.trim() ? link.trim() : null,
          isRolling,
          priority,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
      }
      resetForm();
      router.refresh();
    });
  };

  const onDelete = (id: string) => {
    if (!globalThis.confirm('이 공지를 삭제할까요?')) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteNoticeAdminAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (editingId === id) resetForm();
      router.refresh();
    });
  };

  return (
    <>
      <div className={styles.headRow}>
        <h1 className={styles.h1}>공지 관리</h1>
        <Link href="/notices" className={styles.back}>
          ← 공지 목록
        </Link>
      </div>

      <form className={styles.formCard} onSubmit={onSubmit}>
        <h2 className={styles.formTitle}>{editingId ? '공지 수정' : '새 공지'}</h2>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="notice-title">
            제목
          </label>
          <input
            id="notice-title"
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={500}
            autoComplete="off"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="notice-content">
            본문
          </label>
          <textarea
            id="notice-content"
            className={styles.textarea}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            rows={10}
            maxLength={50_000}
            placeholder="공지 내용을 입력하세요."
            autoComplete="off"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="notice-link">
            관련 링크 (선택, 상세 페이지 하단에 표시)
          </label>
          <input
            id="notice-link"
            className={styles.input}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            maxLength={2000}
            autoComplete="off"
            placeholder="/support 또는 https://..."
          />
        </div>
        <div className={styles.rowInline}>
          <div className={styles.field} style={{ marginBottom: 0, minWidth: '8rem' }}>
            <label className={styles.label} htmlFor="notice-priority">
              우선순위
            </label>
            <input
              id="notice-priority"
              type="number"
              className={styles.input}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </div>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={isRolling}
              onChange={(e) => setIsRolling(e.target.checked)}
            />
            상단 롤링 바에 표시
          </label>
        </div>
        <div className={styles.actions}>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={pending}>
            {editingId ? '저장' : '등록'}
          </button>
          {editingId ? (
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={resetForm}>
              취소
            </button>
          ) : null}
        </div>
      </form>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>제목</th>
              <th className={styles.th}>롤링</th>
              <th className={styles.th}>우선</th>
              <th className={styles.th} style={{ minWidth: '9rem' }}>
                작업
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className={styles.td} colSpan={4}>
                  등록된 공지가 없습니다.
                </td>
              </tr>
            ) : (
              items.map((n) => (
                <tr key={n.id}>
                  <td className={styles.td}>{n.title}</td>
                  <td className={styles.td}>{n.isRolling ? '예' : '아니오'}</td>
                  <td className={styles.td}>{n.priority}</td>
                  <td className={styles.td}>
                    <button type="button" className={styles.rowBtn} onClick={() => loadIntoForm(n)}>
                      수정
                    </button>
                    <button
                      type="button"
                      className={`${styles.rowBtn} ${styles.rowBtnDanger}`}
                      onClick={() => onDelete(n.id)}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
