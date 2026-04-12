/**
 * 메인 인기(·hot) 탭 및 복도별 인기 상위 정렬에 공통 사용.
 * 점수 = (좋아요 수 × LIKE) + (조회수 × VIEW) — 내림차순, 동점 시 최신순.
 */
export const HOT_POPULARITY_LIKE_WEIGHT = 10;
export const HOT_POPULARITY_VIEW_WEIGHT = 1;

/**
 * 인기 집계에 포함할 최근 일수. 오래된 글이 상단을 고정하지 않도록 제한.
 * 0이면 기간 제한 없음(전체 기간).
 */
export const HOT_POPULAR_MAX_AGE_DAYS = 30;

export function hotPopularityCutoffDate(): Date | null {
  if (HOT_POPULAR_MAX_AGE_DAYS <= 0) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - HOT_POPULAR_MAX_AGE_DAYS);
  return d;
}
