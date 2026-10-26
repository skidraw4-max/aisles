/**
 * I-061: rule-based screen audit (no AI). Pure functions over LayoutMetrics; every finding cites the rule, viewport,
 * page and element boxes. Thresholds follow WCAG 2.2 (contrast 1.4.3: 4.5:1 / 3:1 large; target size 2.5.8: 24px).
 * Area status never turns PASS without measurement: missing pages are NOT_TESTED, /mypage is BLOCKED.
 */
import type { AuditPageResult } from './audit-hook';
import type { Box, LayoutMetrics } from './layout-probe';
import type { AuditViewportName } from './viewports';

export type AuditArea = 'LAYOUT' | 'MOBILE' | 'A11Y' | 'NAVIGATION';
export type AuditStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT_TESTED' | 'BLOCKED' | 'ERROR';
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type Finding = {
  area: AuditArea;
  rule: string;
  severity: Severity;
  status: 'FAIL' | 'WARN';
  viewport: AuditViewportName;
  path: string;
  message: string;
  boxes: Box[];
  source: 'RULE';
};

export const AUDIT_AREAS: readonly AuditArea[] = ['LAYOUT', 'MOBILE', 'A11Y', 'NAVIGATION'];
export const MIN_TARGET_PX = 24;

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
const contains = (a: Box, b: Box) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

export function analyzePage(path: string, viewport: AuditViewportName, m: LayoutMetrics): Finding[] {
  const out: Finding[] = [];
  const f = (area: AuditArea, rule: string, severity: Severity, status: 'FAIL' | 'WARN', message: string, boxes: Box[] = []) =>
    out.push({ area, rule, severity, status, viewport, path, message, boxes: boxes.slice(0, 10), source: 'RULE' });
  const mobile = viewport === 'MOBILE';
  if (m.docWidth > m.viewportWidth + 2) {
    f(mobile ? 'MOBILE' : 'LAYOUT', 'LAYOUT_HORIZONTAL_OVERFLOW', mobile ? 'HIGH' : 'MEDIUM', 'FAIL', `페이지 폭 ${m.docWidth}px 이 화면 폭 ${m.viewportWidth}px 보다 넓어 가로 스크롤이 생깁니다.`, m.overflowBoxes);
  }
  if (m.clippedBoxes.length > 0) {
    f(mobile ? 'MOBILE' : 'LAYOUT', 'TEXT_CLIPPED', m.clippedBoxes.length >= 5 ? 'MEDIUM' : 'LOW', 'WARN', `글자가 잘려 보이는 요소 ${m.clippedBoxes.length}개.`, m.clippedBoxes);
  }
  if (mobile) {
    const small = m.interactive.filter((b) => b.w < MIN_TARGET_PX || b.h < MIN_TARGET_PX);
    if (small.length > 0) f('MOBILE', 'TAP_TARGET_SMALL', small.length >= 5 ? 'MEDIUM' : 'LOW', small.length >= 5 ? 'FAIL' : 'WARN', `터치 영역이 ${MIN_TARGET_PX}px 미만인 버튼/링크 ${small.length}개.`, small);
    const overlap: Box[] = [];
    for (let i = 0; i < m.interactive.length && overlap.length < 10; i += 1) {
      for (let j = i + 1; j < m.interactive.length; j += 1) {
        const a = m.interactive[i];
        const b = m.interactive[j];
        if (overlaps(a, b) && !contains(a, b) && !contains(b, a)) {
          overlap.push(a, b);
          break;
        }
      }
    }
    if (overlap.length > 0) f('MOBILE', 'TAP_TARGET_OVERLAP', 'MEDIUM', 'FAIL', `서로 겹치는 버튼/링크 ${overlap.length / 2}쌍.`, overlap);
  }
  const low = m.lowContrast.filter((s) => s.ratio < (s.large ? 3 : 4.5));
  if (low.length > 0) {
    const worst = Math.min(...low.map((s) => s.ratio));
    f('A11Y', 'CONTRAST_LOW', low.length >= 5 ? 'MEDIUM' : 'LOW', 'FAIL', `명암비 기준(4.5:1, 큰 글자 3:1) 미달 글자 ${low.length}곳, 최저 ${worst}:1.`, low.map((s) => s.box));
  }
  if (!m.navVisible) f('NAVIGATION', 'NAV_NOT_VISIBLE', 'MEDIUM', 'WARN', '보이는 메뉴(내비게이션)를 찾지 못했습니다.');
  if (m.headings === 0) f('A11Y', 'HEADINGS_MISSING', 'LOW', 'WARN', '제목(h1~h3) 구조가 없습니다.');
  return out;
}

export type AreaSummary = { area: AuditArea; viewport: AuditViewportName; status: AuditStatus; findings: number; pagesMeasured: number; pagesNotTested: number; pagesBlocked: number };

export function summarizeAudit(pages: readonly AuditPageResult[]): { findings: Finding[]; areas: AreaSummary[]; status: AuditStatus } {
  const findings: Finding[] = [];
  for (const p of pages) if (p.status === 'PASS' && p.metrics) findings.push(...analyzePage(p.path, p.viewport, p.metrics));
  const viewports = [...new Set(pages.map((p) => p.viewport))];
  const areas: AreaSummary[] = [];
  for (const viewport of viewports) {
    const vp = pages.filter((p) => p.viewport === viewport);
    const measured = vp.filter((p) => p.status === 'PASS' && p.metrics).length;
    const notTested = vp.filter((p) => p.status === 'NOT_TESTED' || p.status === 'ERROR').length;
    const blocked = vp.filter((p) => p.status === 'BLOCKED').length;
    for (const area of AUDIT_AREAS) {
      if (area === 'MOBILE' && viewport !== 'MOBILE') continue;
      const fs = findings.filter((x) => x.area === area && x.viewport === viewport);
      let status: AuditStatus;
      if (measured === 0) status = blocked > 0 && notTested === 0 ? 'BLOCKED' : vp.some((p) => p.status === 'ERROR') ? 'ERROR' : 'NOT_TESTED';
      else if (fs.some((x) => x.status === 'FAIL')) status = 'FAIL';
      else if (fs.length > 0 || notTested > 0) status = 'PARTIAL';
      else status = 'PASS';
      areas.push({ area, viewport, status, findings: fs.length, pagesMeasured: measured, pagesNotTested: notTested, pagesBlocked: blocked });
    }
  }
  const order: AuditStatus[] = ['FAIL', 'ERROR', 'PARTIAL', 'NOT_TESTED', 'BLOCKED', 'PASS'];
  const status = areas.length === 0 ? 'NOT_TESTED' : order.find((s) => areas.some((a) => a.status === s)) ?? 'NOT_TESTED';
  return { findings, areas, status };
}
