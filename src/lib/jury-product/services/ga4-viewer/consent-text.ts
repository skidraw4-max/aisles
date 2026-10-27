/** I-075: GA4 viewer invite consent. Bump the version whenever the text changes. */
export const GA4_VIEWER_CONSENT_VERSION = 'ga4-viewer-consent-v1';

export const GA4_VIEWER_CONSENT_TEXT = [
  'GA4 속성의 관리자 권한이 있고, 아래 서비스 계정을 "뷰어"로 초대하는 데 동의해요.',
  'Jury는 GA4 Data API의 읽기 전용 권한(analytics.readonly)으로 집계 지표만 읽어요. 설정 변경이나 데이터 수정은 하지 않아요.',
  '고객의 Google 계정 비밀번호나 키는 받지 않고 저장하지 않아요.',
  'GA4 관리 > 속성 액세스 관리에서 서비스 계정을 삭제하면 언제든 접근이 끊겨요.',
] as const;

export const GA4_VIEWER_STEPS = [
  'GA4 관리(톱니바퀴) > 속성 > 속성 액세스 관리로 이동해요.',
  '오른쪽 위 + 버튼 > 사용자 추가를 눌러요.',
  '아래 서비스 계정 이메일을 붙여 넣고, 역할은 "뷰어"를 선택해요. "새 사용자에게 이메일로 알림"은 꺼도 돼요.',
  '관리 > 속성 설정 > 속성 세부정보에서 속성 ID(숫자)를 복사해 아래에 입력해요.',
] as const;
