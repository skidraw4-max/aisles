/** Home dashboard KPI cards → product nav destinations (RM-02b). */
export const DASHBOARD_STAT_HREFS = {
  connectedServices: '/services',
  evidence: '/evidence',
  inFlightReviews: '/reviews',
  openImprovements: '/improvements',
} as const;

export type DashboardStatKind = keyof typeof DASHBOARD_STAT_HREFS;

export function dashboardStatAriaLabel(kind: DashboardStatKind, metric: string, title: string): string {
  const n = metric === '집계 불가' ? metric : `${metric}개`;
  const dest =
    kind === 'connectedServices'
      ? '서비스 목록'
      : kind === 'evidence'
        ? '심사 요청'
        : kind === 'inFlightReviews'
          ? '결과 목록'
          : '개선 작업';
  return `${title} ${n}, ${dest}으로 이동`;
}
