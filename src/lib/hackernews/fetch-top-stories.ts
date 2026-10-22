import type { HackerNewsItem } from '@/lib/hackernews/types';

const FIREBASE_BASE = 'https://hacker-news.firebaseio.com/v0';

export async function fetchTopStoryIds(maxIds: number): Promise<number[]> {
  const res = await fetch(`${FIREBASE_BASE}/topstories.json`, {
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`topstories HTTP ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error('topstories: 응답이 배열이 아님');
  }
  return data
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    .slice(0, maxIds);
}

export async function fetchHackerNewsItem(id: number): Promise<HackerNewsItem | null> {
  const res = await fetch(`${FIREBASE_BASE}/item/${id}.json`, {
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as HackerNewsItem | null;
  return data && typeof data.id === 'number' ? data : null;
}

/** 병렬 배치로 아이템 조회 (과도한 동시 요청 방지) */
export async function fetchItemsBatched(
  ids: number[],
  batchSize: number,
): Promise<HackerNewsItem[]> {
  const out: HackerNewsItem[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    const rows = await Promise.all(chunk.map((id) => fetchHackerNewsItem(id)));
    for (const row of rows) {
      if (row) out.push(row);
    }
  }
  return out;
}
