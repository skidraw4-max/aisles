/** UX stage 3: one state-based next action on Home. Links only to existing, implemented screens. */
export function homeNextAction(board: { services: string; connectedServices: string; inFlightReviews: string; reviews: string; openImprovements: string }): { title: string; description: string; label: string; href: string } {
  // Counts are display strings; anything that is not a plain number (e.g. 집계 불가) never triggers a rule.
  const zero = (v: string) => v === '0';
  const some = (v: string) => /^\d+$/.test(v) && Number(v) > 0;
  if (zero(board.services)) return { title: '먼저 서비스를 연결하세요', description: '서비스를 연결하면 심사를 요청할 수 있어요.', label: '서비스 연결하기', href: '/services/new' };
  if (zero(board.connectedServices)) return { title: '서비스 연결 상태를 확인하세요', description: '정상 연결된 서비스가 없어요. 연결 상태를 먼저 확인해 주세요.', label: '서비스 확인하기', href: '/services' };
  if (some(board.inFlightReviews)) return { title: '진행 중인 심사가 있어요', description: '심사가 끝나면 결과 목록에서 확인할 수 있어요.', label: '진행 상황 보기', href: '/reviews' };
  if (zero(board.reviews)) return { title: '첫 심사를 요청하세요', description: '서비스 화면의 화면 심사 탭에서 “이 결과로 위원 심사하기”로 바로 시작할 수 있어요.', label: '새로 심사하기', href: '/services' };
  if (some(board.openImprovements)) return { title: '열린 개선 작업을 확인하세요', description: '심사 결과로 만든 개선 작업이 남아 있어요.', label: '개선 작업 보기', href: '/improvements' };
  return { title: '최근 심사 결과를 확인하세요', description: '주요 문제와 권장 조치를 바로 확인할 수 있어요.', label: '결과 보기', href: '/reviews' };
}
