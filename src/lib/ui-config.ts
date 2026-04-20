import type { Category } from '@prisma/client';
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import {
  CATEGORY_TO_UI_KEY,
  defaultUiLabelMap,
  UI_CONFIG_SEED,
} from '@/lib/ui-config-defaults';
import { isPrismaUiConfigTableMissing } from '@/lib/prisma-ui-config';

const FALLBACK = defaultUiLabelMap();

export { CATEGORY_TO_UI_KEY };

/**
 * 서버 컴포넌트/서버 액션에서 단일 라벨 조회.
 * DB에 없거나 테이블 미생성 시 기본값.
 */
export async function getLabel(key: string): Promise<string> {
  const all = await getAllUiLabels();
  return all[key] ?? FALLBACK[key] ?? '';
}

/**
 * 전체 UI 라벨 맵 (DB 우선, 누락 키는 시드 기본값).
 * 동일 요청에서 layout·page·자식 서버 컴포넌트가 각각 호출해도 DB는 1회만 조회한다.
 */
export const getAllUiLabels = cache(async (): Promise<Record<string, string>> => {
  const merged = { ...FALLBACK };
  try {
    const rows = await prisma.uiConfig.findMany();
    for (const r of rows) {
      merged[r.key] = r.value;
    }
  } catch (e) {
    if (!isPrismaUiConfigTableMissing(e)) {
      throw e;
    }
  }
  return merged;
});

/** 복도(카테고리) 표시명 — `getAllUiLabels()` 맵과 함께 사용 */
export function corridorLabel(map: Record<string, string>, category: Category): string {
  const k = CATEGORY_TO_UI_KEY[category];
  return (k && map[k]) || FALLBACK[k] || category;
}

/** `home.hero.lead_filtered` 등 `{{category}}` 치환 */
export function applyTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let out = template;
  for (const [name, val] of Object.entries(vars)) {
    out = out.split(`{{${name}}}`).join(val);
  }
  return out;
}

export function descriptionForKey(key: string): string | undefined {
  return UI_CONFIG_SEED.find((r) => r.key === key)?.description;
}
