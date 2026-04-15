import type { Category } from '@prisma/client';

/** 메인 `?category=` 쿼리 (LAB ↔ Prisma RECIPE) */
const HOME_QUERY_TO_CATEGORY: Record<string, Category> = {
  LAB: 'RECIPE',
  GALLERY: 'GALLERY',
  LOUNGE: 'LOUNGE',
  GOSSIP: 'GOSSIP',
  BUILD: 'BUILD',
  LAUNCH: 'LAUNCH',
};

export function parseHomeCategoryQuery(
  raw: string | string[] | undefined | null
): Category | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || typeof v !== 'string') return null;
  const k = v.trim().toUpperCase();
  return HOME_QUERY_TO_CATEGORY[k] ?? null;
}

/** 메인 `?category=` 쿼리 문자열 (RECIPE → LAB) */
export function categoryToHomeQuery(category: Category): string {
  switch (category) {
    case 'RECIPE':
      return 'LAB';
    case 'GALLERY':
      return 'GALLERY';
    case 'LOUNGE':
      return 'LOUNGE';
    case 'GOSSIP':
      return 'GOSSIP';
    case 'BUILD':
      return 'BUILD';
    case 'LAUNCH':
      return 'LAUNCH';
    default:
      return 'GALLERY';
  }
}

export function homeHrefForCategory(category: Category): string {
  return `/?category=${categoryToHomeQuery(category)}`;
}

/** UI 라벨 ↔ Prisma `Post.category` */
export const POST_CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'RECIPE', label: 'Lab' },
  { value: 'GALLERY', label: 'Gallery' },
  { value: 'LOUNGE', label: 'Lounge' },
  { value: 'GOSSIP', label: 'Gossip' },
  { value: 'BUILD', label: 'Build' },
  { value: 'LAUNCH', label: 'Launch' },
];

/** /upload 셀렉트용 (순서: LAB → GALLERY → LOUNGE → GOSSIP → BUILD → LAUNCH) */
export const UPLOAD_CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'RECIPE', label: 'LAB' },
  { value: 'GALLERY', label: 'GALLERY' },
  { value: 'LOUNGE', label: 'LOUNGE' },
  { value: 'GOSSIP', label: 'GOSSIP' },
  { value: 'BUILD', label: 'BUILD' },
  { value: 'LAUNCH', label: 'LAUNCH' },
];

const VALUES = new Set(POST_CATEGORY_OPTIONS.map((o) => o.value));

export function parsePostCategory(raw: string | null | undefined): Category | null {
  if (!raw || !VALUES.has(raw as Category)) return null;
  return raw as Category;
}

/** 썸네일 없이 글 작성 가능 (제목 + 본문) — 커뮤니티 복도 */
export function categoryAllowsOptionalThumbnail(category: Category): boolean {
  return category === 'LOUNGE' || category === 'GOSSIP';
}

/** 메인 피드: 퀘이사존식 한 줄 리스트 (LAB·GALLERY는 그리드) */
export function isFeedBoardListCategory(category: Category | null): boolean {
  return category === 'LOUNGE' || category === 'GOSSIP';
}
