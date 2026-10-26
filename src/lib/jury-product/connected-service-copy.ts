/**
 * I-048: Korean guidance copy for the connected-service detail page and the read-only account UI.
 * Display only; no behavior depends on these strings.
 */
// Dependency-free on purpose: imported by client components (ReadOnlyAccountCredentialForm).

/** Must equal DEFAULT_RETENTION_DAYS / MAX_RETENTION_DAYS in services/readonly-account/consent.ts (tested). */
export const CREDENTIAL_RETENTION_DAYS = 14;

/** Shown when a connected-service (AISLE_SELF) review was cut off by the 300s function limit. */
export const CONNECTED_REVIEW_STALE_TEXT = '시간 안에 끝나지 않아 중단됐어요. 다시 실행할 수 있어요';

/** I-049: window event fired by ReviewSubmitButton when a review submit starts. */
export const REVIEW_SUBMITTING_EVENT = 'jury:review-submitting';

export const NOT_MEASURED_TEXT = '측정 안 됨';

export const CONNECTED_REVIEW_PENDING_NOTE = '심사는 최대 5분 걸릴 수 있어요. 결과는 [결과] 메뉴에서 확인하세요';

export const REVIEW_ALREADY_RUNNING_TEXT = '진행 중인 심사가 있어요. 잠시 후 결과를 확인하세요';

export const UNMEASURED_METRICS_NOTE =
  '읽기 전용 계정은 사용자에게 보이는 화면만 확인할 수 있어서 일부 지표는 측정되지 않아요. "측정 안 됨"은 값이 0이라는 뜻이 아니에요.';

export const BLOCKED_REQUESTS_NOTE = '광고·분석 스크립트 등 허용 범위 밖 요청을 안전을 위해 차단한 수예요. 오류가 아니에요.';

export const SCOPE_REENTRY_NOTE = '방금 동의한 범위와 같은지 확인하기 위해 다시 입력해요.';

export const AUTH_ORIGIN_HELP =
  '로그인을 별도 인증 서버(예: Supabase)에서 처리하는 서비스만 입력하세요. 이 도메인은 로그인에만 쓰고 쓰기 요청은 차단해요.';

export const SELECTOR_HELP = {
  username: '로그인 화면의 아이디(이메일) 입력란을 가리키는 CSS 선택자예요. 예: #email',
  password: '비밀번호 입력란의 CSS 선택자예요. 예: #password',
  submit: '로그인 버튼의 CSS 선택자예요. 예: button[type=submit]',
  successPrefix: '로그인에 성공하면 이동하는 주소의 앞부분이에요. 모르면 / 로 두세요.',
} as const;

export const CREDENTIAL_RETENTION_NOTE = `저장된 계정은 ${CREDENTIAL_RETENTION_DAYS}일 뒤 자동 파기돼요. 계속 쓰려면 교체 저장으로 갱신하세요.`;

/** I-049 */
export const OBSERVATION_PATHS_HELP = '비워두면 로그인 후 접근 가능한 메뉴를 자동으로 찾아 관찰해요. 입력한 경로는 함께 관찰해요.';
export const AUTO_DISCOVERY_NOTE = '로그인 후 메뉴를 자동으로 찾아 최대 20개 화면을 조회만 해요(약 3~4분). 로그아웃·삭제·결제처럼 보이는 링크와 버튼·폼은 누르지 않아요.';
export const DISCOVERED_PAGE_BADGE = '자동 발견';

export const READONLY_PROVIDER_LABEL = '읽기 전용 계정';
export const READONLY_CONNECTION_NOTICE = '저장한 읽기 전용 계정으로 로그인해 허용한 화면만 조회해요. 입력·수정·삭제 요청은 차단해요.';

export function connectedMetricText(
  value: number | null,
  availability: string,
  format: (value: number | null, availability: string) => string,
): string {
  if (availability === 'NOT_MEASURED' || availability === 'NOT_AVAILABLE') return NOT_MEASURED_TEXT;
  return format(value, availability);
}

/** One status word per card: RUNNING is "진행 중" unless it went stale; no request is "심사 없음". */
export function connectedReviewStatusText(
  status: string | null | undefined,
  stale: boolean,
  label: (value: string) => string,
): string {
  if (!status) return '심사 없음';
  if (status === 'RUNNING') return stale ? '중단됨' : '진행 중';
  return label(status);
}
