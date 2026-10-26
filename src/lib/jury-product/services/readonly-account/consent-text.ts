/** Client-safe consent text (no node:* imports) so client components can render it. */
export const READONLY_ACCOUNT_CONSENT_VERSION = 'readonly-account-consent-v1';

export const READONLY_ACCOUNT_CONSENT_TEXT = [
  '제공하는 계정의 권한 수준과 관계없이 Jury는 지정한 범위의 화면을 읽기로만 관찰하며 저장·제출·삭제를 하지 않습니다.',
  'Jury는 GET 계열 요청만 허용하고, 허용 도메인 밖 이동과 폼 제출을 기술적으로 차단합니다.',
  '권한이 높은 계정일수록 유출 또는 의도치 않은 변경 시 영향이 커질 수 있습니다. 심사 전용 최소 권한 계정 사용을 권장합니다.',
  '자격증명은 암호화되어 저장되고 화면·로그에 표시되지 않으며, 심사 종료 또는 보관 기간 만료 시 파기됩니다.',
  '심사 후 계정 비밀번호 변경 또는 계정 삭제를 권장합니다.',
] as const;
