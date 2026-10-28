/**
 * I-063: pure view model for the 화면 심사 tab (no CSS, no DB) so node tests cover labels and ordering.
 * No overall score: each area×viewport shows its own status, and NOT_TESTED / BLOCKED are never shown as 통과.
 */
import { parsePageErrors } from '../readonly-account/page-errors';

export const STATUS_LABEL: Record<string, string> = {
  PASS: '통과',
  FAIL: '문제 있음',
  PARTIAL: '일부 확인',
  NOT_TESTED: '확인 못 함',
  BLOCKED: '차단됨',
  ERROR: '오류',
};
export const AREA_LABEL: Record<string, string> = { LAYOUT: '레이아웃', MOBILE: '모바일', A11Y: '접근성', NAVIGATION: '메뉴' };
export const VIEWPORT_LABEL: Record<string, string> = { DESKTOP: '데스크톱 1366×768', MOBILE: '모바일 390×844' };
export const SEVERITY_LABEL: Record<string, string> = { HIGH: '높음', MEDIUM: '보통', LOW: '낮음' };
export const SCREEN_AUDIT_NOTES = [
  '로그인 후 읽기만 합니다. 클릭·입력·저장·결제·삭제는 하지 않습니다.',
  '/mypage 등 개인정보 화면은 기본 차단되고, 스크린샷은 찍기 전에 입력칸·개인정보로 보이는 글자를 가립니다.',
  '스크린샷은 비공개 저장소에 14일 보관 후 자동 삭제됩니다.',
  '모바일은 실제 휴대폰처럼(모바일 브라우저·터치) 로그인 상태 그대로 확인합니다. 모바일 전용 주소로 이동하는 사이트는 그 주소가 허용 출처에 있어야 합니다.',
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

/** I-068: guidance lines from the audit summary (mobile host outside scope, environment-limited findings). */
export function guidanceText(summary: unknown): string[] {
  const s = summary && typeof summary === 'object' ? (summary as { mobileOriginsNotAllowed?: unknown; envLimitedFindings?: unknown }) : {};
  const out: string[] = [];
  const origins = Array.isArray(s.mobileOriginsNotAllowed) ? s.mobileOriginsNotAllowed.filter((o): o is string => typeof o === 'string') : [];
  if (origins.length > 0) {
    out.push(`모바일 화면이 ${origins.join(', ')} 로 이동해 확인하지 못했습니다. 연결 설정의 “허용 출처”에 이 주소를 추가하고 다시 동의한 뒤 새로 심사해 주세요. (자동으로 추가하지 않습니다)`);
  }
  const env = Number(s.envLimitedFindings) || 0;
  if (env > 0) out.push(`${env}건은 스타일·글꼴이 일부 불러와지지 않은 상태에서 측정되어 심각도를 한 단계 낮췄습니다(환경 제약).`);
  return out;
}

export const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** I-064: re-review diff. Findings match on rule + viewport + page path (ids differ between runs). */
export type DiffFinding = { rule: string; viewport: string; path: string | null; message: string };
export type AuditDiff = { fixed: DiffFinding[]; remaining: DiffFinding[]; added: DiffFinding[] };
export function findingKey(f: DiffFinding): string {
  return `${f.rule}|${f.viewport}|${f.path ?? ''}`;
}
export function diffAudits(previous: DiffFinding[], current: DiffFinding[], currentTestedPaths?: Set<string>): AuditDiff {
  const cur = new Map(current.map((f) => [findingKey(f), f]));
  const prev = new Map(previous.map((f) => [findingKey(f), f]));
  // A previous finding counts as fixed only if its page/viewport was measured again this time.
  const measured = (f: DiffFinding) => !currentTestedPaths || currentTestedPaths.has(`${f.viewport}|${f.path ?? ''}`);
  return {
    fixed: [...prev.values()].filter((f) => !cur.has(findingKey(f)) && measured(f)),
    remaining: [...prev.values()].filter((f) => cur.has(findingKey(f))),
    added: [...cur.values()].filter((f) => !prev.has(findingKey(f))),
  };
}

/** I-096: page×viewport entries that showed the site's own error screen (empty for audits before I-096). */
/** I-098: label for pages that showed the site's own error screen (distinct from 차단됨). */
export const ERROR_SCREEN_LABEL = '오류 화면';

export function errorScreenRows(summary: unknown): { path: string; viewport: string; errors: string[] }[] {
  const raw = summary && typeof summary === 'object' ? (summary as { errorScreens?: unknown }).errorScreens : null;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is { path: string; viewport: string } => Boolean(r) && typeof r.path === 'string' && typeof r.viewport === 'string')
    .slice(0, 50)
    .map((r) => ({ path: r.path.split(/[?]/)[0].slice(0, 200), viewport: r.viewport, errors: parsePageErrors((r as { errors?: unknown }).errors) }));
}

export const ERROR_SCREEN_NOTE =
  '이 화면들은 사이트의 오류 화면(예: “오류가 발생했습니다”)이 떠서 측정하지 않았습니다. 읽기 전용 보호 장치가 저장·갱신 요청(POST 등)을 막아 사이트가 오류를 낸 것일 수 있습니다. 아래 “차단된 요청”에서 같은 화면의 요청을 확인해 주세요. 이 화면에서는 레이아웃 문제를 세지 않습니다.';

export const BLOCK_REASON_LABEL: Record<string, string> = { ORIGIN: '허용 안 된 도메인', METHOD: '조회 외 요청', FORM_SUBMIT: '폼 제출', LOGIN_ALREADY_USED: '재로그인', STUBBED: '분석·광고 대체' };

/** HH:MM:SS KST for blocked-request rows. */
export function formatKstTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const k = new Date(d.getTime() + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())} KST`;
}
