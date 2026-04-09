import type { Category } from '@prisma/client';
import { parseHomeFeedSort } from '@/lib/feed-sort';
import { parseHomeCategoryQuery } from '@/lib/post-categories';

/** 콘텐츠 탭 바 활성 키 */
export type ContentTabId = 'latest' | 'hot' | 'lab' | 'gallery' | 'build' | 'launch';

export function getContentTabFromSearchParams(search: {
  get: (key: string) => string | null;
}): ContentTabId {
  const cat = parseHomeCategoryQuery(search.get('category'));
  if (cat === 'RECIPE') return 'lab';
  if (cat === 'GALLERY') return 'gallery';
  if (cat === 'BUILD') return 'build';
  if (cat === 'LAUNCH') return 'launch';
  if (parseHomeFeedSort(search.get('sort')) === 'hot') return 'hot';
  return 'latest';
}

/** 서버에서 URL → 쇼케이스/피드용 */
export function homeViewFromSearchParams(sp: {
  category?: string | string[];
  sort?: string | string[];
}): { category: Category | null; sort: 'new' | 'hot' } {
  const category = parseHomeCategoryQuery(sp.category);
  const sort = parseHomeFeedSort(sp.sort);
  return { category, sort };
}
