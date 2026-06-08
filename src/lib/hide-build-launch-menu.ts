/**
 * AdSense 심사 등 — BUILD·LAUNCH 복도를 **메인 네비·홈 탭**에서만 숨김.
 * 직접 URL(`/?category=BUILD`), 업로드 카테고리, 관리자 링크, 게시글은 유지.
 *
 * Vercel: Project → Settings → Environment Variables
 *   `NEXT_PUBLIC_HIDE_BUILD_LAUNCH_MENU=true`  → 숨김
 *   unset / `false`                          → 표시 (기본)
 */
export function isBuildLaunchMenuHidden(): boolean {
  const raw = process.env.NEXT_PUBLIC_HIDE_BUILD_LAUNCH_MENU?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function isBuildLaunchCorridor(key: string): boolean {
  const k = key.trim().toUpperCase();
  return k === 'BUILD' || k === 'LAUNCH';
}

/** 복도 queryKey·탭 id 등 (대소문자 무관) */
export function shouldShowBuildLaunchInNav(key: string | null | undefined): boolean {
  if (!isBuildLaunchMenuHidden()) return true;
  if (!key?.trim()) return true;
  return !isBuildLaunchCorridor(key);
}
