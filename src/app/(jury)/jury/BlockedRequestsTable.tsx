/**
 * I-096: table of requests the read-only guard blocked (origin+path, method, reason, page, time in KST).
 * No hooks and no CSS-module import (node tests load client forms), so it renders anywhere; callers pass class names.
 * Old runs without details render nothing.
 */
import * as React from 'react';
import type { BlockedDetail } from '@/lib/jury-product/services/readonly-account/blocked-details';
import { BLOCK_REASON_LABEL, formatKstTime } from '@/lib/jury-product/services/screen-audit/view-model';

export function BlockedRequestsTable(props: { details: readonly BlockedDetail[] | undefined; total?: number; highlightPages?: readonly string[]; classes?: { wrap?: string; table?: string; muted?: string } }) {
  const details = props.details ?? [];
  if (details.length === 0) return null;
  const c = props.classes ?? {};
  const muted: React.CSSProperties | undefined = c.muted ? undefined : { color: '#a8b5c9' };
  const hi = new Set(props.highlightPages ?? []);
  // I-097: analytics/ad requests answered locally are listed apart from hard blocks.
  const stubbed = details.filter((d) => d.reason === 'STUBBED').length;
  const hard = details.length - stubbed;
  return (
    <details>
      <summary>
        차단된 요청 상세 {hard}건{props.total && props.total > hard ? ` (전체 ${props.total}건 중 앞 ${hard}건)` : ''}
        {stubbed > 0 ? ` · 분석·광고 대체 ${stubbed}건` : ''}
      </summary>
      <div className={c.wrap} style={c.wrap ? undefined : { overflowX: 'auto' }}>
        <table className={c.table} style={c.table ? undefined : { borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
          <thead>
            <tr>
              <th scope="col">시각</th>
              <th scope="col">열린 화면</th>
              <th scope="col">요청</th>
              <th scope="col">방식</th>
              <th scope="col">차단 이유</th>
            </tr>
          </thead>
          <tbody>
            {details.map((d, i) => (
              <tr key={`${d.at}-${i}`}>
                <td>{formatKstTime(d.at)}</td>
                <td>
                  {d.page ?? '-'}
                  {d.page && hi.has(d.page) ? <span className={c.muted} style={muted}> · 오류 화면</span> : null}
                </td>
                <td>
                  {d.origin}
                  {d.path}
                </td>
                <td>{d.method}</td>
                <td>{BLOCK_REASON_LABEL[d.reason] ?? d.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {stubbed > 0 ? (
        <p className={c.muted} style={muted}>분석·광고 대체: 분석·광고 스크립트는 외부로 보내지 않고 빈 응답으로 대신해 화면이 멈추지 않게 했어요.</p>
      ) : null}
      <p className={c.muted} style={muted}>주소는 도메인과 경로만 저장해요(검색어·쿠키·내용은 저장하지 않음).</p>
    </details>
  );
}
