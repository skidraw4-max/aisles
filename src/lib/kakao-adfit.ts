import type { Category } from '@prisma/client';

const DEFAULT_KAKAO_ADFIT_UNIT = 'DAN-hWgqfwr6VUfKXWm5';

/** Kakao AdFit 광고 단위 ID (환경 변수로 오버라이드 가능) */
export function getKakaoAdfitUnitId(override?: string): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  const fromEnv = process.env.NEXT_PUBLIC_KAKAO_ADFIT_UNIT?.trim();
  return fromEnv || DEFAULT_KAKAO_ADFIT_UNIT;
}

/** 웹 인피드 Kakao 광고 — AI LAB(RECIPE)·GALLERY 복도만 */
export function isKakaoInfeedAdCategory(category: Category | null): boolean {
  return category === 'RECIPE' || category === 'GALLERY';
}
