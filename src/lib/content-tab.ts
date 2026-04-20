import type { Category } from '@prisma/client';
import { parseHomeCategoryQuery } from '@/lib/post-categories';

/** 콘텐츠 탭 바 활성 키 */
export type ContentTabId =
  | 'latest'
  | 'lab'
  | 'gallery'
  | 'lounge'
  | 'gossip'
  | 'build'
  | 'launch';

export function getContentTabFromSearchParams(search: {
  get: (key: string) => string | null;
}): ContentTabId {
  const cat = parseHomeCategoryQuery(search.get('category'));
  if (cat === 'RECIPE') return 'lab';
  if (cat === 'GALLERY') return 'gallery';
  if (cat === 'LOUNGE') return 'lounge';
  if (cat === 'GOSSIP') return 'gossip';
  if (cat === 'BUILD') return 'build';
  if (cat === 'LAUNCH') return 'launch';
  if (cat === 'TREND') return 'latest';
  return 'latest';
}

/** 서버에서 URL → 피드용 복도 필터 (`sort` 등 기타 쿼리는 무시) */
export function homeViewFromSearchParams(sp: {
  category?: string | string[];
  sort?: string | string[];
}): { category: Category | null } {
  const category = parseHomeCategoryQuery(sp.category);
  return { category };
}
