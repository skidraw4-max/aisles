'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createNoticeAdminAction,
  deleteNoticeAdminAction,
  updateNoticeAdminAction,
} from '@/app/notices/actions';
import { runGeekNewsSyncAdminAction } from '@/app/notices/geeknews-sync-actions';
import { runHackerNewsSyncAdminAction } from '@/app/notices/hackernews-sync-actions';
import { runVergeSyncAdminAction } from '@/app/notices/verge-sync-actions';
import { runAiBreakfastSyncAdminAction } from '@/app/notices/aibreakfast-sync-actions';
import { runMitNewsSyncAdminAction } from '@/app/notices/mit-news-sync-actions';
import { runYoutubeSyncAdminAction } from '@/app/notices/youtube-sync-actions';
import type { GeekNewsItemResult } from '@/lib/geeknews/run-geeknews-sync';
import type { HackerNewsItemResult } from '@/lib/hackernews/run-hackernews-sync';
import type { AiBreakfastItemResult } from '@/lib/aibreakfast/run-aibreakfast-sync';
import type { MitNewsItemResult } from '@/lib/mit-news/run-mit-news-sync';
import type { YoutubeItemResult } from '@/lib/youtube-sync/run-youtube-sync';
import type { VergeItemResult } from '@/lib/verge/run-verge-sync';
import styles from './admin.module.css';

function formatGeekNewsSyncAlert(r: Awaited<ReturnType<typeof runGeekNewsSyncAdminAction>>): string {
  if (!r.ok) {
    return [`실패`, `단계: ${r.step}`, r.message, `코드: ${r.error}`].join('\n');
  }
  const lines = [
    `완료: 신규 ${r.created}건 (목록에서 최대 ${r.scanned}건 스캔)`,
    `강제 모드: ${r.force ? '예' : '아니오'}`,
    '',
    ...r.results.slice(0, 20).map((x: GeekNewsItemResult) => {
      const u = x.externalUrl.length > 56 ? `${x.externalUrl.slice(0, 56)}…` : x.externalUrl;
      const extra = x.detail ? ` — ${x.detail}` : x.postId ? ` → ${x.postId}` : '';
      return `${x.status}: ${u}${extra}`;
    }),
  ];
  if (r.results.length > 20) {
    lines.push(`… 외 ${r.results.length - 20}건`);
  }
  return lines.join('\n');
}

function formatHackerNewsSyncAlert(r: Awaited<ReturnType<typeof runHackerNewsSyncAdminAction>>): string {
  if (!r.ok) {
    return [`실패`, `단계: ${r.step}`, r.message, `코드: ${r.error}`].join('\n');
  }
  const lines = [
    `완료: 신규 ${r.created}건 (후보 ${r.scanned}건 스캔)`,
    `강제 모드: ${r.force ? '예' : '아니오'}`,
    '',
    ...r.results.slice(0, 20).map((x: HackerNewsItemResult) => {
      const u = x.externalUrl.length > 56 ? `${x.externalUrl.slice(0, 56)}…` : x.externalUrl;
      const extra = x.detail ? ` — ${x.detail}` : x.postId ? ` → ${x.postId}` : '';
      return `${x.status}: ${u}${extra}`;
    }),
  ];
  if (r.results.length > 20) {
    lines.push(`… 외 ${r.results.length - 20}건`);
  }
  return lines.join('\n');
}

function formatVergeSyncAlert(r: Awaited<ReturnType<typeof runVergeSyncAdminAction>>): string {
  if (!r.ok) {
    return [`실패`, `단계: ${r.step}`, r.message, `코드: ${r.error}`].join('\n');
  }
  const lines = [
    `완료: 신규 ${r.created}건 (RSS 상위 ${r.scanned}건 스캔)`,
    `강제 모드: ${r.force ? '예' : '아니오'}`,
    '',
    ...r.results.slice(0, 20).map((x: VergeItemResult) => {
      const u = x.link.length > 56 ? `${x.link.slice(0, 56)}…` : x.link;
      const extra = x.detail ? ` — ${x.detail}` : x.postId ? ` → ${x.postId}` : '';
      return `${x.status}: ${u}${extra}`;
    }),
  ];
  if (r.results.length > 20) {
    lines.push(`… 외 ${r.results.length - 20}건`);
  }
  return lines.join('\n');
}

function formatAiBreakfastSyncAlert(r: Awaited<ReturnType<typeof runAiBreakfastSyncAdminAction>>): string {
  if (!r.ok) {
    return [`실패`, `단계: ${r.step}`, r.message, `코드: ${r.error}`].join('\n');
  }
  const lines = [
    `완료: 신규 ${r.created}건 (최신 포스트 ${r.scanned}건 기준)`,
    `강제 모드: ${r.force ? '예' : '아니오'}`,
    '',
    ...r.results.slice(0, 20).map((x: AiBreakfastItemResult) => {
      const u = x.link.length > 56 ? `${x.link.slice(0, 56)}…` : x.link;
      const extra = x.detail ? ` — ${x.detail}` : x.postId ? ` → ${x.postId}` : '';
      return `${x.status}: ${u}${extra}`;
    }),
  ];
  if (r.results.length > 20) {
    lines.push(`… 외 ${r.results.length - 20}건`);
  }
  return lines.join('\n');
}

function formatMitNewsSyncAlert(r: Awaited<ReturnType<typeof runMitNewsSyncAdminAction>>): string {
  if (!r.ok) {
    return [`실패`, `단계: ${r.step}`, r.message, `코드: ${r.error}`].join('\n');
  }
  const lines = [
    `완료: 신규 ${r.created}건 (RSS ${r.scanned}건 중 최대 ${r.results.length}건 처리)`,
    `강제 모드: ${r.force ? '예' : '아니오'}`,
    '',
    ...r.results.slice(0, 20).map((x: MitNewsItemResult) => {
      const u = x.link.length > 56 ? `${x.link.slice(0, 56)}…` : x.link;
      const extra = x.detail ? ` — ${x.detail}` : x.postId ? ` → ${x.postId}` : '';
      return `${x.status}: ${u}${extra}`;
    }),
  ];
  if (r.results.length > 20) {
    lines.push(`… 외 ${r.results.length - 20}건`);
  }
  return lines.join('\n');
}

function formatYoutubeSyncAlert(r: Awaited<ReturnType<typeof runYoutubeSyncAdminAction>>): string {
  if (!r.ok) {
    return [`실패`, `단계: ${r.step}`, r.message, `코드: ${r.error}`].join('\n');
  }
  const lines = [
    `완료: 신규 ${r.created}건`,
    `강제 모드: ${r.force ? '예' : '아니오'}`,
    '',
    ...r.results.slice(0, 30).map((x: YoutubeItemResult) => {
      const id = x.videoId ? (x.videoId.length > 14 ? `${x.videoId.slice(0, 14)}…` : x.videoId) : '(알 수 없음)';
      const extra = x.detail ? ` — ${x.detail}` : x.postId ? ` → ${x.postId}` : '';
      return `${x.channel}: ${x.status}: ${id}${extra}`;
    }),
  ];
  if (r.results.length > 30) {
    lines.push(`… 외 ${r.results.length - 30}건`);
  }
  return lines.join('\n');
}

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

  const onGeekNewsSync = (force: boolean) => {
    if (force && !globalThis.confirm('강제 모드: 이미 등록된 원문 URL도 다시 처리합니다. DB 중복 시 오류로 표시됩니다. 계속할까요?')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await runGeekNewsSyncAdminAction(force);
      globalThis.alert(formatGeekNewsSyncAlert(res));
      if (res.ok && res.created > 0) {
        router.refresh();
      }
    });
  };

  const onHackerNewsSync = (force: boolean) => {
    if (force && !globalThis.confirm('강제 모드: 이미 등록된 원문 URL도 다시 처리합니다. DB 중복 시 오류로 표시됩니다. 계속할까요?')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await runHackerNewsSyncAdminAction(force);
      globalThis.alert(formatHackerNewsSyncAlert(res));
      if (res.ok && res.created > 0) {
        router.refresh();
      }
    });
  };

  const onVergeSync = (force: boolean) => {
    if (force && !globalThis.confirm('강제 모드: 이미 등록된 원문 URL도 다시 처리합니다. DB 중복 시 오류로 표시됩니다. 계속할까요?')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await runVergeSyncAdminAction(force);
      globalThis.alert(formatVergeSyncAlert(res));
      if (res.ok && res.created > 0) {
        router.refresh();
      }
    });
  };

  const onAiBreakfastSync = (force: boolean) => {
    if (force && !globalThis.confirm('강제 모드: 이미 등록된 원문 URL도 다시 처리합니다. DB 중복 시 오류로 표시됩니다. 계속할까요?')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await runAiBreakfastSyncAdminAction(force);
      globalThis.alert(formatAiBreakfastSyncAlert(res));
      if (res.ok && res.created > 0) {
        router.refresh();
      }
    });
  };

  const onMitNewsSync = (force: boolean) => {
    if (force && !globalThis.confirm('강제 모드: 이미 등록된 원문 URL도 다시 처리합니다. DB 중복 시 오류로 표시됩니다. 계속할까요?')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await runMitNewsSyncAdminAction(force);
      globalThis.alert(formatMitNewsSyncAlert(res));
      if (res.ok && res.created > 0) {
        router.refresh();
      }
    });
  };

  const onYoutubeSync = (force: boolean) => {
    if (force && !globalThis.confirm('강제 모드: 이미 등록된 영상 ID도 다시 처리 시도합니다. 중복 시 DB 오류로 표시됩니다. 계속할까요?')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await runYoutubeSyncAdminAction(force);
      globalThis.alert(formatYoutubeSyncAlert(res));
      if (res.ok && res.created > 0) {
        router.refresh();
      }
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

      <div className={styles.formCard}>
        <h2 className={styles.formTitle}>GeekNews 동기화</h2>
        <p className={styles.helpText}>
          news.hada.io 최신 목록을 가져와 요약 글을 Lounge 복도에 등록합니다. 일반 동기화는 이미 등록된 원문은 건너뜁니다. 강제는
          중복 스킵 없이 시도합니다(이미 있으면 DB 오류로 표시).
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={pending}
            onClick={() => onGeekNewsSync(false)}
          >
            GeekNews 수동 동기화
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            disabled={pending}
            onClick={() => onGeekNewsSync(true)}
          >
            GeekNews 강제 동기화
          </button>
        </div>
      </div>

      <div className={styles.formCard}>
        <h2 className={styles.formTitle}>Hacker News 동기화</h2>
        <p className={styles.helpText}>
          Firebase topstories에서 인기 글을 가져와 AI 키워드 우선·score 순으로 최대 5건 요약해 Lounge에 등록합니다. GeekNews와
          동일 원문 URL은 중복되지 않습니다.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={pending}
            onClick={() => onHackerNewsSync(false)}
          >
            Hacker News 수동 동기화
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            disabled={pending}
            onClick={() => onHackerNewsSync(true)}
          >
            Hacker News 강제 동기화
          </button>
        </div>
      </div>

      <div className={styles.formCard}>
        <h2 className={styles.formTitle}>The Verge (Tech) 동기화</h2>
        <p className={styles.helpText}>
          The Verge RSS에서 제목에 AI 키워드가 있는 기사만 골라(GeekNews·HN과 동일 규칙) 최대 5건을 요약해 LOUNGE(AI 트렌드)에 등록합니다. 썸네일은 저장하지 않습니다. 원문 URL이 겹치면
          건너뜁니다. 강제는 중복 스킵 없이 시도합니다(이미 있으면 DB 오류로 표시).
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={pending}
            onClick={() => onVergeSync(false)}
          >
            The Verge 수동 동기화
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            disabled={pending}
            onClick={() => onVergeSync(true)}
          >
            The Verge 강제 동기화
          </button>
        </div>
      </div>

      <div className={styles.formCard}>
        <h2 className={styles.formTitle}>AI Breakfast 동기화</h2>
        <p className={styles.helpText}>
          aibreakfast.beehiiv.com 메인에서 최신 /p/ 포스트 1건을 가져와 Gemini로 핵심 주제 3가지를 요약해 LOUNGE(AI 트렌드)에
          등록합니다. 썸네일은 넣지 않습니다. 다른 뉴스 소스와 원문 URL이 겹치면 건너뜁니다.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={pending}
            onClick={() => onAiBreakfastSync(false)}
          >
            AI Breakfast 수동 동기화
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            disabled={pending}
            onClick={() => onAiBreakfastSync(true)}
          >
            AI Breakfast 강제 동기화
          </button>
        </div>
      </div>

      <div className={styles.formCard}>
        <h2 className={styles.formTitle}>MIT News 동기화</h2>
        <p className={styles.helpText}>
          news.mit.edu RSS(Artificial Intelligence 토픽)에서 최대 3건을 가져와 중학생 눈높이 요약 후 LOUNGE(AI 트렌드)에 등록합니다.
          제목은 [MIT 연구] 말머리를 붙입니다. 다른 소스와 원문 URL이 겹치면 건너뜁니다.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={pending}
            onClick={() => onMitNewsSync(false)}
          >
            MIT News 수동 동기화
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            disabled={pending}
            onClick={() => onMitNewsSync(true)}
          >
            MIT News 강제 동기화
          </button>
        </div>
      </div>

      <div className={styles.formCard}>
        <h2 className={styles.formTitle}>YouTube 동기화 (MIT OCW · DeepMind)</h2>
        <p className={styles.helpText}>
          MIT OpenCourseWare는 LAB(RECIPE), Google DeepMind은 TREND 복도에 등록합니다. 채널 RSS 최신 영상 중 자막이 있는
          것만 처리하며, 채널당 최대 1건·영상 간 5초 간격입니다. 자막은 한국어 우선·없으면 영어 등(요약은 한국어). 상세
          페이지 상단에 플레이어 임베드·요약 본문·MIT 시 CC BY-NC-SA 출처 문구가 붙습니다.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={pending}
            onClick={() => onYoutubeSync(false)}
          >
            YouTube 수동 동기화
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            disabled={pending}
            onClick={() => onYoutubeSync(true)}
          >
            YouTube 강제 동기화
          </button>
        </div>
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
