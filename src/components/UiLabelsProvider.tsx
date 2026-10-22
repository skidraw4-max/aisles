'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Category } from '@prisma/client';
import { CATEGORY_TO_UI_KEY } from '@/lib/ui-config-defaults';
import { POST_CATEGORY_OPTIONS } from '@/lib/post-categories';

const UiLabelsContext = createContext<Record<string, string> | null>(null);

export function UiLabelsProvider({
  labels,
  children,
}: {
  labels: Record<string, string>;
  children: ReactNode;
}) {
  return <UiLabelsContext.Provider value={labels}>{children}</UiLabelsContext.Provider>;
}

export function useUiLabels(): Record<string, string> | null {
  return useContext(UiLabelsContext);
}

/** 단일 키 — Provider 없으면 빈 문자열 */
export function useUiLabel(key: string): string {
  const m = useUiLabels();
  return m?.[key] ?? '';
}

/** 복도 표시명 (클라이언트) — Provider 없을 때 POST_CATEGORY_OPTIONS 폴백 */
export function useCorridorLabel(category: Category): string {
  const m = useUiLabels();
  const k = CATEGORY_TO_UI_KEY[category];
  if (m && k && m[k]) return m[k];
  return POST_CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? category;
}
