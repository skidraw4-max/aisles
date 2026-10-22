/**
 * Korean display labels for the Jury console.
 * Display only: raw enum values, result codes and stored values are never changed here.
 * Unknown values fall back to a readable form of the raw value.
 */

export const STATUS_LABELS: Readonly<Record<string, string>> = {
  // 공통 상태
  AVAILABLE: '사용 가능',
  CONNECTED: '연결됨',
  DISCOVERY_PENDING: '서비스 확인 중',
  PROPOSED: '승인 대기',
  APPROVED: '승인됨',
  PENDING: '대기 중',
  RUNNING: '진행 중',
  IN_PROGRESS: '진행 중',
  COMPLETED: '완료',
  BLOCKED: '중단됨',
  GATED: '보류됨',
  NOT_READY: '준비 중',
  READY: '준비 완료',
  LOCKED: '권한 없음',
  REVIEWED: '심사 완료',
  OPEN: '열림',
  FAILED: '실패',
  PASS: '통과',
  PASSED: '통과',
  FAIL: '실패',
  REVISION_REQUIRED: '수정 필요',
  NONE: '없음',
  REVOKED: '거부됨',
  READ_ONLY_ACCOUNT: '읽기 전용 계정',
  UNKNOWN: '알 수 없음',
  EXECUTED: '실행 완료',
  COMPLETE: '완료',
  NOT_STARTED: '시작 전',
  WAITING: '기다리는 중',
  MISSING: '없음',
  LAST_RESULT_AVAILABLE: '최근 결과 있음',
  HEALTHY: '정상',
  ATTENTION: '확인 필요',
  // 운영 단계
  DISCOVERING: '서비스 확인 중',
  SCOPE_REVIEW: '범위 검토 중',
  EVIDENCE_READY: '검증 근거 준비됨',
  IMPROVEMENT_AVAILABLE: '개선 작업 있음',
  IMPROVING: '개선 중',
  RE_REVIEWED: '재심사 완료',
  // 자료 상태
  NOT_MEASURED: '측정되지 않음',
  NOT_AVAILABLE: '확인할 수 없음',
  PERMISSION_DENIED: '권한 없음',
  COLLECTION_FAILED: '수집 실패',
  UNSUPPORTED: '지원하지 않음',
  // 심사 결론
  VERIFY: '검증 필요',
  REWORD: '수정 필요',
  ACCEPT: '확인 완료',
  FIX: '수정 필요',
  RECHECK_REQUIRED: '재확인 필요',
  // 심사 유형
  FULL_REVIEW: '전체 심사',
  // 역할 (enum 값은 그대로 두고 표시만 바꿈)
  OWNER: '소유자',
  ADMIN: '관리자',
  DEVELOPER: '개발자',
  REVIEWER: '리뷰어',
  VIEWER: '열람자',
};

export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  TENANT_CREATED: '조직 생성',
  MEMBERSHIP_ADDED: '멤버 추가',
  MEMBERSHIP_ROLE_CHANGED: '멤버 역할 변경',
  MEMBERSHIP_REMOVED: '멤버 제거',
  INVITATION_CREATED: '초대 생성',
  INVITATION_ACCEPTED: '초대 수락',
  SERVICE_CONNECTION_CREATED: '서비스 연결 생성',
  SERVICE_CONNECTION_ACTIVATED: '서비스 연결 활성화',
  SERVICE_DISCOVERY_STARTED: '서비스 확인 시작',
  SERVICE_MEMBER_ADDED: '서비스 멤버 추가',
  SERVICE_MEMBER_REMOVED: '서비스 멤버 제거',
  SERVICE_MEMBER_PERMISSION_CHANGED: '서비스 권한 변경',
  DISCOVERY_RECORDED: '서비스 확인 기록',
  SCOPE_PROPOSED: '범위 제안',
  SCOPE_APPROVED: '범위 승인',
  SCOPE_REVOKED: '범위 거부',
  EVIDENCE_COLLECTION_STARTED: '검증 근거 수집 시작',
  EVIDENCE_COLLECTED: '검증 근거 수집 완료',
  EVIDENCE_RECORDED: '검증 근거 저장',
  EVIDENCE_INTAKE_COMPLETED: '검증 근거 입력 완료',
  REVIEW_STARTED: '심사 시작',
  REVIEW_COMPLETED: '심사 완료',
  REVIEW_FAILED: '심사 실패',
  REVIEW_DECISION_RESOLVED: '심사 결론 확정',
  REVIEW_REREVIEW_REQUESTED: '재심사 요청',
  REVIEW_REREVIEW_STARTED: '재심사 시작',
  REVIEW_REREVIEW_COMPLETED: '재심사 완료',
  HUMAN_DECISION: '담당자 판단',
  HUMAN_DECISION_RECORDED: '담당자 판단 기록',
  DECISION_CYCLE_CREATED: '판단 주기 생성',
  IMPROVEMENT_TASK_CREATED: '개선 작업 생성',
  VERIFICATION_TASK_CREATED: '검증 작업 생성',
  VERIFICATION_REVIEW_STARTED: '검증 심사 시작',
  AGENT_HANDOFF_CREATED: '에이전트 전달',
  AGENT_EXECUTION_STARTED: '에이전트 실행 시작',
  AGENT_EXECUTION_COMPLETED: '에이전트 실행 완료',
  CHANGE_GATE_STARTED: '변경 검사 시작',
  CHANGE_GATE_COMPLETED: '변경 검사 완료',
  CHANGE_GATE_APPROVED: '변경 검사 승인',
  CHANGE_GATE_BLOCKED: '변경 검사 차단',
  CHANGE_GATE_RESOLUTION_CREATED: '변경 검사 처리 기록',
  MANUAL_APPROVE: '수동 승인',
  MANUAL_BLOCK: '수동 차단',
  AUTO_LOOP_ENABLED: '자동 실행 켜짐',
  AUTO_LOOP_DISABLED: '자동 실행 꺼짐',
  AUTO_LOOP_MODE_CHANGED: '자동 실행 방식 변경',
  API_KEY_STORED: 'API 키 저장',
};

/** Fallback keeps the old behavior: `SOME_VALUE` → `some value`. */
export function userLabel(value: string | null | undefined): string {
  if (!value) return '확인 필요';
  return STATUS_LABELS[value] ?? AUDIT_ACTION_LABELS[value] ?? value.replaceAll('_', ' ').toLowerCase();
}

export function auditActionLabel(value: string | null | undefined): string {
  if (!value) return '확인 필요';
  return AUDIT_ACTION_LABELS[value] ?? STATUS_LABELS[value] ?? value.replaceAll('_', ' ').toLowerCase();
}

/** Fixed English display strings produced by read-only projections. */
export const TEXT_LABELS: Readonly<Record<string, string>> = {
  'Not available': '확인할 수 없음',
  'Not available yet': '아직 확인할 수 없음',
  'Not measured': '측정되지 않음',
  'Permission denied': '권한 없음',
  'Collection failed': '수집 실패',
  'Unsupported': '지원하지 않음',
  'REDACTED': '가려짐',
  'No services connected yet': '아직 연결된 서비스가 없습니다',
  'No evidence yet': '아직 검증 근거가 없습니다',
  'No reviews yet': '아직 심사 결과가 없습니다',
  'No improvement tasks yet': '아직 개선 작업이 없습니다',
  'No audit events yet': '아직 감사 이력이 없습니다',
  'No review': '심사 없음',
  'No activity': '활동 없음',
  'No execution': '실행 없음',
  'No evidence collected yet': '아직 수집된 검증 근거가 없습니다',
  'Not started': '시작 전',
  'Not run': '실행 전',
  'Not reviewed yet': '아직 재심사 전',
  'Unknown': '알 수 없음',
  'just now': '방금 전',
  'None': '없음',
  // 다음 할 일 (service-operations-status.ts)
  'Run discovery': '서비스 확인 실행',
  'Review access scope': '접근 범위 검토',
  'Collect evidence': '검증 근거 수집',
  'Run review': '심사 실행',
  'Review improvement task': '개선 작업 검토',
  'Run agent': '에이전트 실행',
  'Review change gate': '변경 검사 검토',
  'Run re-review': '재심사 실행',
  'No action required': '할 일 없음',
  // 최근 활동 (service-operations-status.ts)
  'Evidence collected': '검증 근거 수집 완료',
  'Review completed': '심사 완료',
  'Improvement task created': '개선 작업 생성',
  'Agent execution completed': '에이전트 작업 완료',
  'Change Gate approved': '변경 검사 승인',
  'Re-review completed': '재심사 완료',
};

/**
 * Localizes a projected display string without changing the projection.
 * Handles `0 · measured zero`, relative ages (`8 h ago`) and fixed phrases.
 */
export function displayText(value: string | null | undefined): string {
  if (value == null || value.length === 0) return TEXT_LABELS['Not available'];
  if (value === '0 · measured zero') return '0 · 측정값 0';
  const age = /^(\d+) (min|h|d) ago$/.exec(value);
  if (age) return `${age[1]}${age[2] === 'min' ? '분' : age[2] === 'h' ? '시간' : '일'} 전`;
  return TEXT_LABELS[value] ?? STATUS_LABELS[value] ?? value;
}

/** Improvement trace titles and line keys from read-only projections (display only). */
export const TRACE_LABELS: Readonly<Record<string, string>> = {
  'Review': '심사',
  'Improvement Task': '개선 작업',
  'ImprovementTask': '개선 작업',
  'Human Decision': '담당자 판단',
  'Human Approval': '담당자 승인',
  'Agent Execution': '에이전트 작업',
  'AgentExecution': '에이전트 작업',
  'Scope Check': '범위 검사',
  'Intent Check': '의도 검사',
  'Change Gate': '변경 검사',
  'Change Gate Review': '변경 검사 심사',
  'Re-review': '재심사',
  'Next Improvement Task': '다음 개선 작업',
  'Verification': '검증',
  'Verification Re-review': '검증 재심사',
  'Effect Validation': '효과 검증',
  'Decision Cycle': '판단 주기',
  'Outcome': '최종 결과',
  'Decision': '결론',
  'Effect': '효과',
  'status': '상태',
  'decision': '결론',
  'outcome': '결과',
  'taskType': '작업 유형',
  'createdAt': '생성 시각',
  'updatedAt': '수정 시각',
  'startedAt': '시작 시각',
  'finishedAt': '종료 시각',
  'requestedAt': '요청 시각',
  'agent': '에이전트',
  'changedFiles': '변경 파일',
  'agentReportedFiles': '에이전트 보고 파일',
  'reason': '사유',
  'errorCode': '오류 코드',
  'discrepancy': '불일치',
  'finding': '발견 사항',
  'risk': '위험',
  'source': '출처',
  'sourceDecision': '원래 결론',
  'iteration': '반복 차수',
  'verificationAttempts': '검증 시도 횟수',
  'sameDecisionCount': '같은 결론 횟수',
  'sameConflictCount': '같은 충돌 횟수',
  'overclaimDetected': '과장 주장 감지',
};

/** Unknown keys (ids, workspace, code …) stay as their technical name. */
export function traceLabel(value: string): string {
  return TRACE_LABELS[value] ?? value;
}

/** Committee member roles (A~E) for the review result 위원 의견 tab. Display only. */
export const COMMITTEE_ROLE_LABELS: Readonly<Record<string, string>> = {
  A: 'UX/UI',
  B: '트렌드·유입',
  C: '경쟁 서비스',
  D: '기술·성능',
  E: '커뮤니티·성장',
};

export function committeeRoleLabel(memberId: string): string {
  return COMMITTEE_ROLE_LABELS[memberId] ?? memberId;
}

/** Evidence strength shown as a fallback confidence for results stored before member opinions. */
export const EVIDENCE_STRENGTH_LABELS: Readonly<Record<string, string>> = {
  strong: '높음',
  moderate: '보통',
  unknown: '확인 불가',
};

/** 0..1 confidence → "72%". null → 확인 불가. */
export function confidenceLabel(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '확인 불가';
  return `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`;
}

/** Notices for the 위원 의견 tab. */
export const MEMBER_OPINION_NOTICE = {
  LEGACY: '이 심사는 위원 의견 저장 기능 이전에 실행되어 위원별 의견이 없습니다. 재심사 시 표시됩니다.',
  SECRET: '보안상 위원 의견을 표시하지 않습니다.',
  EMPTY: '표시할 위원 의견이 없습니다.',
} as const;

/**
 * Decision → next-step guidance shown instead of a "failure" wording.
 * Keys are the stored decision codes; codes themselves are unchanged.
 */
export const DECISION_GUIDANCE: Readonly<Record<string, string>> = {
  ACCEPT: '추가 조치 없이 결과를 확인하면 됩니다.',
  VERIFY: '근거가 부족한 주장이 있습니다. 검증 근거 탭에서 부족한 근거를 확인한 뒤 자료를 보완해 다시 요청하세요.',
  REWORD: '표현이 근거보다 강합니다. 검증 근거 탭에서 근거를 확인하고 표현을 수정한 뒤 다시 요청하세요.',
};
