/** 법적 페이지 공통 — 애드센스·개인정보보호법 고지용 */
export const LEGAL_LAST_REVISED = '2026년 6월 11일';

/** 아동 안전(CSAE) 정책 공개 URL 경로 */
export const CHILD_SAFETY_POLICY_PATH = '/legal/child-safety';

/** 개인정보 보호책임자·법적 문의 (NEXT_PUBLIC_LEGAL_CONTACT_EMAIL 미설정 시 기본값) */
export function getLegalContactEmail(): string {
  return process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || 'skidraw4@gmail.com';
}

/** 아동 안전 담당자 표시명 */
export function getChildSafetyContactName(): string {
  return 'AIsle 운영 담당 (아동 안전)';
}

/** 아동 안전·CSAE 신고 접수 이메일 (법적 문의와 동일) */
export function getChildSafetyContactEmail(): string {
  return getLegalContactEmail();
}

function buildMailtoUrl(subject: string, body: string): string {
  const email = getLegalContactEmail();
  const params = new URLSearchParams({ subject, body });
  return `mailto:${email}?${params.toString()}`;
}

/** UGC·콘텐츠 신고용 mailto (Capacitor WebView·앱 내 신고 경로) */
export function buildContentReportMailtoUrl(options?: { postUrl?: string }): string {
  const lines = [
    '아래 항목을 작성해 보내 주세요.',
    '',
    `신고 대상 URL: ${options?.postUrl?.trim() || '(해당 게시글·댓글·프로필 URL)'}`,
    '신고 사유: ',
    '추가 설명: ',
  ];
  return buildMailtoUrl('[AIsle] 콘텐츠 신고', lines.join('\n'));
}

/** CSAE(아동 성적 학대·착취) 전용 신고 mailto */
export function buildCsaeReportMailtoUrl(options?: { postUrl?: string }): string {
  const lines = [
    'AIsle 아동 안전(CSAE) 신고입니다. 긴급한 경우 즉시 경찰(112) 또는 아동학대 신고(132)에도 연락해 주세요.',
    '',
    `신고 대상 URL: ${options?.postUrl?.trim() || '(해당 게시글·댓글·프로필 URL)'}`,
    '의심 행위 유형(그루밍·CSAM·아동 착취·성착취 협박 등): ',
    '추가 설명: ',
  ];
  return buildMailtoUrl('[AIsle] 아동 안전(CSAE) 신고', lines.join('\n'));
}
