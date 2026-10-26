/**
 * I-063: pure view model for the 화면 심사 tab (no CSS, no DB) so node tests cover labels and ordering.
 * No overall score: each area×viewport shows its own status, and NOT_TESTED / BLOCKED are never shown as 통과.
 */
export const STATUS_LABEL: Record<string, string> = {
  PASS: '통과',
  FAIL: '문제 있음',
  PARTIAL: '일부 확인',
  NOT_TESTED: '확인 못 함',
  BLOCKED: '차단됨(민감 화면)',
  ERROR: '오류',
};
export const AREA_LABEL: Record<string, string> = { LAYOUT: '레이아웃', MOBILE: '모바일', A11Y: '접근성', NAVIGATION: '메뉴' };
export const VIEWPORT_LABEL: Record<string, string> = { DESKTOP: '데스크톱 1366×768', MOBILE: '모바일 390×844' };
export const SEVERITY_LABEL: Record<string, string> = { HIGH: '높음', MEDIUM: '보통', LOW: '낮음' };
export const SCREEN_AUDIT_NOTES = [
  '로그인 후 읽기만 합니다. 클릭·입력·저장·결제·삭제는 하지 않습니다.',
  '/mypage 등 개인정보 화면은 기본 차단되고, 스크린샷은 찍기 전에 입력칸·개인정보로 보이는 글자를 가립니다.',
  '스크린샷은 비공개 저장소에 14일 보관 후 자동 삭제됩니다.',
  '한 번에 최대 8개 화면을 확인하고, 나머지는 “확인 못 함”으로 남겨 재심사에서 이어서 확인합니다.',
];

export type AuditHeader = { id: string; state: string; status: string | null; createdAt: Date; finishedAt: Date | null; parentAuditId: string | null; summary: unknown };
export type AreaRow = { area: string; viewport: string; status: string; findings: number };

export function formatKst(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())} KST`;
}

export function areaRows(summary: unknown): AreaRow[] {
  const areas = summary && typeof summary === 'object' ? (summary as { areas?: unknown }).areas : null;
  if (!Array.isArray(areas)) return [];
  const order = ['LAYOUT', 'MOBILE', 'A11Y', 'NAVIGATION'];
  return areas
    .filter((a): a is AreaRow => a && typeof a.area === 'string' && typeof a.viewport === 'string' && typeof a.status === 'string')
    .map((a) => ({ area: a.area, viewport: a.viewport, status: a.status, findings: Number(a.findings) || 0 }))
    .sort((x, y) => (x.viewport === y.viewport ? order.indexOf(x.area) - order.indexOf(y.area) : x.viewport === 'DESKTOP' ? -1 : 1));
}

export function stopText(summary: unknown): string | null {
  const stop = summary && typeof summary === 'object' ? (summary as { stop?: unknown }).stop : null;
  if (typeof stop !== 'string') return null;
  const map: Record<string, string> = {
    CHALLENGE_REQUIRED: '2단계 인증·캡차가 있어 멈췄습니다.',
    CONSENT_REQUIRED: '연결 설정에서 동의가 필요합니다.',
    CONSENT_STALE: '동의 내용이 바뀌어 다시 동의가 필요합니다.',
    CREDENTIAL_UNAVAILABLE: '저장된 읽기 전용 계정이 없습니다.',
    CREDENTIAL_EXPIRED: '저장된 계정이 만료되었습니다.',
    KEY_NOT_CONFIGURED: '서버 암호화 키가 설정되지 않았습니다.',
    EXECUTOR_DISABLED: '브라우저 실행이 꺼져 있습니다.',
    LOGIN_PLAN_INVALID: '로그인 설정이 없습니다. 연결 설정에서 먼저 관찰을 한 번 성공시켜 주세요.',
  };
  return map[stop] ?? `중간에 멈췄습니다 (${stop}).`;
}

export const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
