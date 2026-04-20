'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react';
import { useUiLabels } from '@/components/UiLabelsProvider';
import styles from '@/app/(root)/page.module.css';

type BestCategory = 'ALL' | 'LAB' | 'GALLERY' | 'LOUNGE' | 'GOSSIP' | 'BUILD' | 'LAUNCH';

type BestItem = { id: string; title: string; commentCount: number; rank: number };

type ApiResponse = {
  page: number;
  totalPages: number;
  total: number;
  items: BestItem[];
};

const CAT_DEF: { id: BestCategory; labelKey: string }[] = [
  { id: 'ALL', labelKey: 'corridor.all' },
  { id: 'LAB', labelKey: 'corridor.lab' },
  { id: 'GALLERY', labelKey: 'corridor.gallery' },
  { id: 'LOUNGE', labelKey: 'corridor.lounge' },
  { id: 'GOSSIP', labelKey: 'corridor.gossip' },
  { id: 'BUILD', labelKey: 'corridor.build' },
  { id: 'LAUNCH', labelKey: 'corridor.launch' },
];

export function TodaysBest() {
  const m = useUiLabels();
  const [category, setCategory] = useState<BestCategory>('ALL');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ApiResponse>({
    page: 1,
    totalPages: 1,
    total: 0,
    items: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams({ category, page: String(page) });
    fetch(`/api/home-best?${q}`)
      .then((r) => r.json())
      .then((j: ApiResponse) => {
        if (!cancelled) {
          setData({
            page: j.page ?? 1,
            totalPages: Math.max(1, j.totalPages ?? 1),
            total: j.total ?? 0,
            items: Array.isArray(j.items) ? j.items : [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData((d) => ({ ...d, items: [] }));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, page]);

  const setCat = (c: BestCategory) => {
    setCategory(c);
    setPage(1);
  };

  const totalPages = data.totalPages;
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <aside className={styles.todaysBest} aria-labelledby="todays-best-heading">
      <div className={styles.todaysBestHead}>
        <h3 id="todays-best-heading" className={styles.todaysBestTitle}>
          {m?.['home.todays_best.title'] ?? ''}
        </h3>
        <div className={styles.todaysBestPager} role="group" aria-label="페이지">
          <button
            type="button"
            className={styles.todaysBestPagerBtn}
            disabled={!canPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="이전 페이지"
          >
            <ChevronLeft size={18} strokeWidth={2.25} />
          </button>
          <span className={styles.todaysBestPageInd} aria-live="polite">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className={styles.todaysBestPagerBtn}
            disabled={!canNext}
            onClick={() => setPage((p) => p + 1)}
            aria-label="다음 페이지"
          >
            <ChevronRight size={18} strokeWidth={2.25} />
          </button>
        </div>
      </div>

      <div className={styles.todaysBestFilters} role="tablist" aria-label="베스트 복도 필터">
        {CAT_DEF.map((c) => {
          const active = c.id === category;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? `${styles.bestFilterPill} ${styles.bestFilterPillActive}` : styles.bestFilterPill}
              onClick={() => setCat(c.id)}
            >
              {m?.[c.labelKey] ?? ''}
            </button>
          );
        })}
      </div>

      <ul className={styles.todaysBestList}>
        {loading ? (
          <li className={styles.todaysBestLoading}>불러오는 중…</li>
        ) : data.items.length === 0 ? (
          <li className={styles.todaysBestEmpty}>이 구간에 표시할 글이 없습니다.</li>
        ) : (
          data.items.map((item) => (
            <li key={item.id}>
              <Link href={`/post/${item.id}`} className={styles.todaysBestRow}>
                <span
                  className={item.rank <= 3 ? styles.todaysBestRankTop : styles.todaysBestRank}
                  aria-hidden
                >
                  {item.rank}
                </span>
                <span className={styles.todaysBestRowTitle}>{item.title}</span>
                <span className={styles.todaysBestComments}>
                  <MessageCircle className={styles.todaysBestCommentIcon} aria-hidden size={14} strokeWidth={2} />
                  <span className={styles.todaysBestCommentNum}>{item.commentCount}</span>
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}
