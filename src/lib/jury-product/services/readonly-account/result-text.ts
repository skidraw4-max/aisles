/** I-044: Korean messages for READ_ONLY_ACCOUNT action results. Never includes credential material. */
export type ReadonlyAccountFormResult =
  | { ok: true; summary?: { ok: boolean; stop?: string | null; pagesObserved: number; blockedRequestCount: number } }
  | { ok: false; reason: string };

export type ReadonlyAccountFormAction = (prev: ReadonlyAccountFormResult | null, formData: FormData) => ReadonlyAccountFormResult | null | Promise<ReadonlyAccountFormResult | null>;

/** I-049: client wait limit. Login + auto-discovery is budgeted at ~200s (+ per-page timeout) under the 300s page maxDuration. */
export const OBSERVATION_CLIENT_TIMEOUT_MS = 280_000;

/**
 * I-047: wraps a form action so the UI never hangs: resolves CLIENT_TIMEOUT after `ms`,
 * and turns thrown errors into CLIENT_ERROR. The server call itself is not cancelled.
 */
export function withClientDeadline(
  action: ReadonlyAccountFormAction,
  ms: number = OBSERVATION_CLIENT_TIMEOUT_MS,
  setTimer: (fn: () => void, ms: number) => unknown = setTimeout,
  clearTimer: (h: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
): ReadonlyAccountFormAction {
  return async (prev, formData) => {
    let handle: unknown;
    const timeout = new Promise<ReadonlyAccountFormResult>((resolve) => {
      handle = setTimer(() => resolve({ ok: false, reason: 'CLIENT_TIMEOUT' }), ms);
    });
    try {
      return await Promise.race([Promise.resolve(action(prev, formData)), timeout]);
    } catch {
      return { ok: false, reason: 'CLIENT_ERROR' };
    } finally {
      clearTimer(handle);
    }
  };
}

const REASON_TEXT: Record<string, string> = {
  CLIENT_TIMEOUT: '응답이 지연되고 있어요. 잠시 후 새로고침해 최근 관찰 결과를 확인해 주세요.',
  CLIENT_ERROR: '요청 중 오류가 발생했어요. 새로고침 후 다시 시도해 주세요.',
  UNAUTHENTICATED: '로그인이 필요해요.',
  FORBIDDEN: '이 연결을 변경할 권한이 없어요.',
  TENANT_MISMATCH: '다른 조직의 연결이에요.',
  NOT_FOUND: '연결을 찾을 수 없어요.',
  ACCESS_METHOD_UNSUPPORTED: '읽기 전용 계정 방식의 연결이 아니에요.',
  SCOPE_INVALID: '허용 도메인(https)과 관찰 경로(/로 시작)를 확인해 주세요.',
  CONSENT_REQUIRED: '먼저 동의를 저장해 주세요.',
  CONSENT_STALE: '허용 도메인·관찰 경로가 동의한 내용과 다르거나, 동의 내용이 바뀌어(메뉴 자동 관찰 추가) 다시 동의가 필요해요. 동의를 다시 저장해 주세요.',
  CREDENTIAL_INVALID: '아이디와 비밀번호를 확인해 주세요.',
  RETENTION_INVALID: '보관 기간이 올바르지 않아요.',
  NOT_IMPLEMENTED: '준비 중인 기능이에요.',
  KEY_NOT_CONFIGURED: '암호화 키가 설정되지 않아 처리할 수 없어요. 관리자에게 문의해 주세요.',
  LOGIN_PLAN_INVALID: '로그인 주소(https)와 입력란 선택자를 확인해 주세요.',
  CREDENTIAL_UNAVAILABLE: '저장된 계정 정보가 없어요.',
  CREDENTIAL_EXPIRED: '저장된 계정 정보가 만료되었어요. 다시 저장해 주세요.',
  DECRYPT_FAILED: '저장된 계정 정보를 복호화할 수 없어요. 다시 저장해 주세요.',
};

const STOP_TEXT: Record<string, string> = {
  SCOPE_INVALID: '로그인 주소가 허용 도메인에 없어요.',
  ACTION_NOT_ALLOWED: '허용되지 않은 관찰 동작이에요.',
  CHALLENGE_REQUIRED: '추가 인증(캡차·2단계 인증)이 필요해 중단했어요.',
  LOGIN_FAILED: '로그인에 실패했어요.',
  LOGIN_NOT_SUBMITTED: '로그인 요청이 전송되지 않았어요. 입력란·로그인 버튼 선택자와 인증 서버 도메인을 확인해 주세요.',
  LOGIN_NO_REDIRECT: '로그인 후 성공 경로로 이동하지 않았어요. 아이디·비밀번호와 로그인 성공 경로 접두어를 확인해 주세요.',
  LOGIN_BUTTON_DISABLED: '로그인 버튼이 비활성 상태라 누르지 않고 중단했어요. 로그인 버튼 선택자를 확인하고, 아래 차단된 도메인에 로그인 화면에 필요한 스크립트가 있는지 확인해 주세요.',
  LOGIN_FIELD_NOT_FOUND: '로그인 화면에서 입력란이나 로그인 버튼을 찾지 못했어요. 로그인 설정(고급)의 선택자를 사이트에 맞게 바꿔 주세요.',
  NOT_IMPLEMENTED: '관찰 실행기가 꺼져 있어요.',
  NAVIGATION_BLOCKED: '허용 범위를 벗어난 이동이 차단되어 중단했어요.',
  DRIVER_ERROR: '브라우저 실행 중 오류가 발생했어요.',
};

const FIELD_TEXT: Record<string, string> = { USERNAME: '아이디 입력란', PASSWORD: '비밀번호 입력란', SUBMIT: '로그인 버튼' };
const STEP_TEXT: Record<string, string> = {
  LOGIN_PAGE: '로그인 화면 열기',
  FILL_USERNAME: '아이디 입력',
  FILL_PASSWORD: '비밀번호 입력',
  SUBMIT: '로그인 버튼 누르기',
  AFTER_LOGIN: '로그인 후 화면 확인',
  ACTIONS: '관찰 경로 조회',
  DISCOVERY: '메뉴 자동 관찰',
};

/** I-056: extra detail for a stopped run (no selectors, no values). */
export function readonlyAccountStopDetail(input: { stop?: string | null; failedStep?: string | null; missingField?: string | null }): string | null {
  if (!input.stop) return null;
  if (input.stop === 'LOGIN_FIELD_NOT_FOUND' && input.missingField) return `찾지 못한 항목: ${FIELD_TEXT[input.missingField] ?? input.missingField}`;
  if (input.failedStep) return `중단된 단계: ${STEP_TEXT[input.failedStep] ?? input.failedStep}`;
  return null;
}

/** I-056: the form's built-in placeholders; a stored plan still using them likely needs site-specific selectors. */
export const DEFAULT_LOGIN_SELECTORS = { usernameSelector: '#email', passwordSelector: '#password', submitSelector: 'button[type=submit]' } as const;
export function usesDefaultLoginSelectors(login: { usernameSelector?: string; passwordSelector?: string; submitSelector?: string } | null | undefined): boolean {
  if (!login) return false;
  return (
    login.usernameSelector === DEFAULT_LOGIN_SELECTORS.usernameSelector &&
    login.passwordSelector === DEFAULT_LOGIN_SELECTORS.passwordSelector &&
    login.submitSelector === DEFAULT_LOGIN_SELECTORS.submitSelector
  );
}
export const DEFAULT_SELECTOR_WARNING = '저장된 로그인 설정이 기본값(#email / #password)이에요. 사이트의 실제 입력란 선택자로 바꾸지 않으면 입력란을 찾지 못할 수 있어요.';

export function readonlyAccountReasonText(reason: string): string {
  return REASON_TEXT[reason] ?? '처리하지 못했어요.';
}

export function readonlyAccountStopText(stop: string | null | undefined): string {
  if (!stop) return '관찰을 완료했어요.';
  return STOP_TEXT[stop] ?? '관찰을 중단했어요.';
}
