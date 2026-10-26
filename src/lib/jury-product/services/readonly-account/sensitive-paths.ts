/**
 * I-057: paths that are never screenshotted or analysed visually by default (personal-information pages).
 * Matching is by path prefix on segment boundaries, case-insensitive. Used by the screen-audit pipeline (I-060+).
 */
export const DEFAULT_SENSITIVE_PATH_PREFIXES: readonly string[] = ['/mypage'];

export function isSensitivePath(path: string, prefixes: readonly string[] = DEFAULT_SENSITIVE_PATH_PREFIXES): boolean {
  let p: string;
  try {
    p = new URL(path, 'https://x.invalid').pathname.toLowerCase();
  } catch {
    return true;
  }
  return prefixes.some((raw) => {
    const pre = raw.toLowerCase().replace(/\/+$/, '');
    return p === pre || p.startsWith(`${pre}/`) || p.startsWith(`${pre}.`);
  });
}
