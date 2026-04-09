export type HomeFeedSort = 'new' | 'hot';

/** 메인 `?sort=` — 기본 최신순 */
export function parseHomeFeedSort(raw: string | string[] | undefined | null): HomeFeedSort {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'hot') return 'hot';
  return 'new';
}
