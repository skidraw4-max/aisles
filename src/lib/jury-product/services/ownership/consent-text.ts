/** I-072: ownership verification consent. Bump the version whenever the text changes. */
export const OWNERSHIP_CONSENT_VERSION = 'ownership-verification-v1';

export const OWNERSHIP_CONSENT_TEXT = [
  '이 사이트를 운영하거나 관리할 권한이 있어요.',
  'Jury는 확인을 위해 선택한 위치(DNS TXT 레코드, 사이트 첫 페이지의 meta 태그, /.well-known/jury-verification.txt) 한 곳만 읽어요.',
  '확인 값은 해시로만 저장하고, 원문 값은 이 화면에서 한 번만 보여 드려요.',
  '확인 후에도 7일마다 다시 확인하고, 연속 3번 실패하면 확인이 만료돼요.',
  '확인 값을 지우면 언제든 확인을 철회할 수 있어요.',
] as const;
