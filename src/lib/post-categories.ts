import type { Category } from '@prisma/client';

/** 메인 `?category=` 쿼리 (LAB ↔ Prisma RECIPE) */
const HOME_QUERY_TO_CATEGORY: Record<string, Category> = {
  LAB: 'RECIPE',
  GALLERY: 'GALLERY',
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
  { value: 'BUILD', label: 'Build' },
  { value: 'LAUNCH', label: 'Launch' },
];

/** /upload 셀렉트용 대문자 라벨 (값은 Prisma enum 그대로) */
export const UPLOAD_CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'RECIPE', label: 'LAB' },
  { value: 'GALLERY', label: 'GALLERY' },
  { value: 'BUILD', label: 'BUILD' },
  { value: 'LAUNCH', label: 'LAUNCH' },
];

const VALUES = new Set(POST_CATEGORY_OPTIONS.map((o) => o.value));

export function parsePostCategory(raw: string | null | undefined): Category | null {
  if (!raw || !VALUES.has(raw as Category)) return null;
  return raw as Category;
}
