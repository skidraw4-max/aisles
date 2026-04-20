import type { Category } from '@prisma/client';
import { defaultPostCategoryOptions } from '@/lib/ui-config-defaults';

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

/** UI 라벨 ↔ Prisma `Post.category` (기본값은 시드와 동일; 런타임 동기화는 `corridorLabel` + DB) */
export const POST_CATEGORY_OPTIONS: { value: Category; label: string }[] = defaultPostCategoryOptions();

/** /upload 셀렉트 순서 (표시 라벨은 UI 설정 `corridor.*`와 동기화) */
export const UPLOAD_CATEGORY_ORDER: Category[] = [
  'RECIPE',
  'GALLERY',
  'LOUNGE',
  'GOSSIP',
  'BUILD',
  'LAUNCH',
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

/** LAB(RECIPE) 프롬프트 유형 — 이미지·비주얼 vs 마케팅·카피(텍스트) */
export type LabPromptKind = 'visual' | 'marketing';

export function labKindFromMetadataParams(params: unknown): LabPromptKind {
  if (!params || typeof params !== 'object' || params === null) return 'visual';
  const k = (params as { labPromptKind?: unknown }).labPromptKind;
  return k === 'marketing' ? 'marketing' : 'visual';
}

/** 요청 본문의 labPromptKind — 없거나 형식이 아니면 null (기본값은 호출부에서 처리) */
export function parseLabPromptKindFromBody(raw: unknown): LabPromptKind | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t === 'marketing') return 'marketing';
  if (t === 'visual') return 'visual';
  return null;
}

/**
 * LOUNGE/GOSSIP 또는 LAB에서 「마케팅·카피」 선택 시 대표 미디어 없이 저장 가능
 */
export function categoryAllowsOptionalMedia(
  category: Category,
  recipeLabKind?: LabPromptKind | null
): boolean {
  if (categoryAllowsOptionalThumbnail(category)) return true;
  return category === 'RECIPE' && recipeLabKind === 'marketing';
}

/** 메인 피드: 퀘이사존식 한 줄 리스트 (LAB·GALLERY는 그리드) */
export function isFeedBoardListCategory(category: Category | null): boolean {
  return category === 'LOUNGE' || category === 'GOSSIP';
}
