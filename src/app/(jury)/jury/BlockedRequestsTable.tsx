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
  return (
    <details>
      <summary>
        차단된 요청 상세 {details.length}건{props.total && props.total > details.length ? ` (전체 ${props.total}건 중 앞 ${details.length}건)` : ''}
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
      <p className={c.muted} style={muted}>주소는 도메인과 경로만 저장합니다(검색어·쿠키·내용은 저장하지 않음).</p>
    </details>
  );
}
