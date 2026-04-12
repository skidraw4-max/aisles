export type HomeFeedSort = 'new' | 'hot';

/** 메인 `?sort=` — 기본 최신순. `popular`는 인기(hot)와 동일 */
export function parseHomeFeedSort(raw: string | string[] | undefined | null): HomeFeedSort {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return 'new';
  const n = v.trim().toLowerCase();
  if (n === 'hot' || n === 'popular') return 'hot';
  return 'new';
}
