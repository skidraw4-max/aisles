/** 법적 페이지 공통 — 애드센스·개인정보보호법 고지용 */
export const LEGAL_LAST_REVISED = '2026년 4월 15일';

/** 개인정보 보호책임자·법적 문의 (NEXT_PUBLIC_LEGAL_CONTACT_EMAIL 미설정 시 기본값) */
export function getLegalContactEmail(): string {
  return process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || 'skidraw4@gmail.com';
}
