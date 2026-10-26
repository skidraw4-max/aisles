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
  CLIENT_TIMEOUT: '응답이 지연되고 있습니다. 잠시 후 새로고침해 최근 관찰 결과를 확인해 주세요.',
  CLIENT_ERROR: '요청 중 오류가 발생했습니다. 새로고침 후 다시 시도해 주세요.',
  UNAUTHENTICATED: '로그인이 필요합니다.',
  FORBIDDEN: '이 연결을 변경할 권한이 없습니다.',
  TENANT_MISMATCH: '다른 조직의 연결입니다.',
  NOT_FOUND: '연결을 찾을 수 없습니다.',
  ACCESS_METHOD_UNSUPPORTED: '읽기 전용 계정 방식의 연결이 아닙니다.',
  SCOPE_INVALID: '허용 도메인(https)과 관찰 경로(/로 시작)를 확인해 주세요.',
  CONSENT_REQUIRED: '먼저 동의를 저장해 주세요.',
  CONSENT_STALE: '허용 도메인·관찰 경로가 동의한 내용과 다르거나, 동의 내용이 바뀌어(메뉴 자동 관찰 추가) 다시 동의가 필요합니다. 동의를 다시 저장해 주세요.',
  CREDENTIAL_INVALID: '아이디와 비밀번호를 확인해 주세요.',
  RETENTION_INVALID: '보관 기간이 올바르지 않습니다.',
  NOT_IMPLEMENTED: '준비 중인 기능입니다.',
  KEY_NOT_CONFIGURED: '암호화 키가 설정되지 않아 처리할 수 없습니다. 관리자에게 문의해 주세요.',
  LOGIN_PLAN_INVALID: '로그인 주소(https)와 입력란 선택자를 확인해 주세요.',
  CREDENTIAL_UNAVAILABLE: '저장된 계정 정보가 없습니다.',
  CREDENTIAL_EXPIRED: '저장된 계정 정보가 만료되었습니다. 다시 저장해 주세요.',
  DECRYPT_FAILED: '저장된 계정 정보를 복호화할 수 없습니다. 다시 저장해 주세요.',
};

const STOP_TEXT: Record<string, string> = {
  SCOPE_INVALID: '로그인 주소가 허용 도메인에 없습니다.',
  ACTION_NOT_ALLOWED: '허용되지 않은 관찰 동작입니다.',
  CHALLENGE_REQUIRED: '추가 인증(캡차·2단계 인증)이 필요해 중단했습니다.',
  LOGIN_FAILED: '로그인에 실패했습니다.',
  LOGIN_NOT_SUBMITTED: '로그인 요청이 전송되지 않았습니다. 입력란·로그인 버튼 선택자와 인증 서버 도메인을 확인해 주세요.',
  LOGIN_NO_REDIRECT: '로그인 후 성공 경로로 이동하지 않았습니다. 아이디·비밀번호와 로그인 성공 경로 접두어를 확인해 주세요.',
  NOT_IMPLEMENTED: '관찰 실행기가 꺼져 있습니다.',
  NAVIGATION_BLOCKED: '허용 범위를 벗어난 이동이 차단되어 중단했습니다.',
  DRIVER_ERROR: '브라우저 실행 중 오류가 발생했습니다.',
};

export function readonlyAccountReasonText(reason: string): string {
  return REASON_TEXT[reason] ?? '처리하지 못했습니다.';
}

export function readonlyAccountStopText(stop: string | null | undefined): string {
  if (!stop) return '관찰을 완료했습니다.';
  return STOP_TEXT[stop] ?? '관찰을 중단했습니다.';
}
