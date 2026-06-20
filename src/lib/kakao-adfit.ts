import type { Category } from '@prisma/client';

const DEFAULT_KAKAO_ADFIT_UNIT = 'DAN-hWgqfwr6VUfKXWm5';
const DEFAULT_KAKAO_ADFIT_MAIN_BANNER_UNIT = 'DAN-hs7bUu3rwYN8Bmtx';

/** 좁은 뷰포트 리더보드 — AdFit 728×90은 ~705px 미만 컨테이너에서 미게재 */
export const KAKAO_LEADERBOARD_DESKTOP_WIDTH = 728;
export const KAKAO_LEADERBOARD_DESKTOP_HEIGHT = 90;
export const KAKAO_LEADERBOARD_MOBILE_WIDTH = 320;
export const KAKAO_LEADERBOARD_MOBILE_HEIGHT = 100;
/** AdFit 728×90이 실제로 채워지는 최소 슬롯 너비(프로덕션 검증 ~705px) */
export const KAKAO_LEADERBOARD_MIN_FILL_WIDTH = 705;

/** Kakao AdFit 광고 단위 ID (환경 변수로 오버라이드 가능) */
export function getKakaoAdfitUnitId(override?: string): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  const fromEnv = process.env.NEXT_PUBLIC_KAKAO_ADFIT_UNIT?.trim();
  return fromEnv || DEFAULT_KAKAO_ADFIT_UNIT;
}

/** 메인 ALL 탭 띠배너(728×90) — Kakao AdFit 단위 ID */
export function getKakaoAdfitMainBannerUnitId(override?: string): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  const fromEnv = process.env.NEXT_PUBLIC_KAKAO_ADFIT_MAIN_BANNER_UNIT?.trim();
  return fromEnv || DEFAULT_KAKAO_ADFIT_MAIN_BANNER_UNIT;
}

/** 복도 탭(LAB·GALLERY 등) 탭 아래 띠배너(728×90) — 미설정 시 메인 배너 단위와 동일 */
export function getKakaoAdfitCorridorBannerUnitId(override?: string): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  const fromEnv = process.env.NEXT_PUBLIC_KAKAO_ADFIT_CORRIDOR_UNIT?.trim();
  if (fromEnv) return fromEnv;
  return getKakaoAdfitMainBannerUnitId();
}

/** 웹 인피드 Kakao 광고 — AI LAB(RECIPE)·GALLERY 복도만 */
export function isKakaoInfeedAdCategory(category: Category | null): boolean {
  return category === 'RECIPE' || category === 'GALLERY';
}
