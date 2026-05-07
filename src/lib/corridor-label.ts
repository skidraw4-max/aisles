import type { Category } from '@prisma/client';
import { CATEGORY_TO_UI_KEY, defaultUiLabelMap } from '@/lib/ui-config-defaults';

const FALLBACK = defaultUiLabelMap();

/** 복도(카테고리) 표시명 — 클라이언트 번들 안전 (Prisma 미사용). 서버에서는 `getAllUiLabels()` 맵을 넘기면 DB 값 반영. */
export function corridorLabel(map: Record<string, string>, category: Category): string {
  const k = CATEGORY_TO_UI_KEY[category];
  return (k && map[k]) || FALLBACK[k] || category;
}
