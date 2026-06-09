/** 카드 그리드 피드: N개 게시글마다 1개 인피드 광고 슬롯 */
export const FEED_AD_INTERVAL = 5;

/** 텍스트 보드 리스트: 첫 화면에 1개만 — 5번째 게시글(0-based index 4) 뒤에 삽입 */
export const FEED_AD_SINGLE_INSERT_AFTER_INDEX = 4;

export type FeedAdMode = 'everyN' | 'singlePerScreen';

export type FeedListItem<T> =
  | { type: 'post'; post: T }
  | { type: 'ad'; slotIndex: number };

function singleAdInsertIndex(postCount: number): number {
  if (postCount <= 0) return -1;
  if (postCount > FEED_AD_SINGLE_INSERT_AFTER_INDEX) return FEED_AD_SINGLE_INSERT_AFTER_INDEX;
  return Math.min(postCount - 1, Math.floor(postCount / 2));
}

/**
 * 게시글 배열에 광고 슬롯을 삽입합니다.
 * - everyN: N번째·2N번째… 게시글 뒤 (카드 그리드)
 * - singlePerScreen: 목록 전체에 슬롯 1개만 (텍스트 보드 리스트)
 */
export function interleaveFeedAdSlots<T>(
  posts: T[],
  adMode: FeedAdMode = 'everyN',
  interval: number = FEED_AD_INTERVAL
): FeedListItem<T>[] {
  if (posts.length === 0) return [];

  if (adMode === 'singlePerScreen') {
    const insertAfter = singleAdInsertIndex(posts.length);
    const result: FeedListItem<T>[] = [];
    for (let i = 0; i < posts.length; i++) {
      result.push({ type: 'post', post: posts[i] });
      if (i === insertAfter) {
        result.push({ type: 'ad', slotIndex: 0 });
      }
    }
    return result;
  }

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
