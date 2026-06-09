/** 카드 그리드 피드: N개 게시글마다 1개 인피드 광고 슬롯 */
export const FEED_AD_INTERVAL = 5;

export type FeedListItem<T> =
  | { type: 'post'; post: T }
  | { type: 'ad'; slotIndex: number };

/**
 * 게시글 배열에 광고 슬롯을 삽입합니다 (5번째·10번째… 게시글 뒤).
 * slotIndex 는 누적 게시글 기준으로 고정되어 페이지네이션 시에도 안정적입니다.
 */
export function interleaveFeedAdSlots<T>(
  posts: T[],
  interval: number = FEED_AD_INTERVAL
): FeedListItem<T>[] {
  if (interval < 1) {
    return posts.map((post) => ({ type: 'post', post }));
  }

  const result: FeedListItem<T>[] = [];
  for (let i = 0; i < posts.length; i++) {
    result.push({ type: 'post', post: posts[i] });
    if ((i + 1) % interval === 0) {
      result.push({ type: 'ad', slotIndex: (i + 1) / interval - 1 });
    }
  }
  return result;
}
