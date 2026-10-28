/**
 * I-063: 화면 심사 tab. Server component; READ_ONLY_ACCOUNT connections only. Shows the latest audit per area and
 * viewport (no overall score), findings with page/viewport, masked screenshots (signed 5-minute links) and history.
 */
import * as React from 'react';
import { shouldShowReadonlyAccountSection, READONLY_ACCOUNT_UI_ENABLED } from '@/lib/jury-product/services/readonly-account/flags';
import { loadScreenAuditView } from '@/lib/jury-product/services/screen-audit/load';
import {
  AREA_LABEL,
  areaRows,
  formatKst,
  SCREEN_AUDIT_NOTES,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  STATUS_LABEL,
  stopText,
  guidanceText,
  VIEWPORT_LABEL,
  errorScreenRows,
  ERROR_SCREEN_NOTE,
} from '@/lib/jury-product/services/screen-audit/view-model';
import styles from './jury.module.css';
import { StatusBadge } from './jury-controls';
import { runScreenAuditAction } from './screen-audit-actions';
import { ScreenAuditRunButton } from './ScreenAuditRunButton';
import { BlockedRequestsTable } from './BlockedRequestsTable';

export async function ScreenAuditSection(props: { tenantId: string; connectionId: string; accessMethod: string | null | undefined }) {
  if (!shouldShowReadonlyAccountSection({ uiEnabled: READONLY_ACCOUNT_UI_ENABLED, accessMethod: props.accessMethod })) {
    return (
      <section className={styles.resultCard}>
        <h2>화면 심사</h2>
        <p>화면 심사는 “읽기 전용 계정” 방식으로 연결된 서비스에서 쓸 수 있습니다.</p>
      </section>
    );
  }
  const view = await loadScreenAuditView(props.tenantId, props.connectionId).catch(() => ({ latest: null, history: [], diff: null }));
  const latest = view.latest;
  const rows = latest ? areaRows(latest.summary) : [];
  const stop = latest ? stopText(latest.summary) : null;
  const guidance = latest ? guidanceText(latest.summary) : [];
  const errorScreens = latest ? errorScreenRows(latest.summary) : [];
  const findings = latest ? [...latest.findings].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)) : [];
  return (
    <section className={styles.resultCard} aria-labelledby="screen-audit-title">
      <div className={styles.resultCardHeader}>
        <h2 id="screen-audit-title">화면 심사</h2>
        <ScreenAuditRunButton connectionId={props.connectionId} label={latest ? '새로 심사' : '화면 심사 시작'} variant="primary" icon={latest ? 'refresh' : 'play'} action={runScreenAuditAction} />
      </div>
      <ul className={styles.resultList}>
        {SCREEN_AUDIT_NOTES.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {latest ? (
        <>
          <h3 className={styles.resultSubhead}>
            최근 심사
            <span className={styles.resultMeta}>{formatKst(latest.createdAt)}</span>
            <StatusBadge status={latest.status ?? (latest.state === 'RUNNING' ? 'RUNNING' : null)} tone={latest.status ? undefined : latest.state === 'RUNNING' ? 'running' : 'neutral'} title={latest.status ?? latest.state}>
              {latest.status ? STATUS_LABEL[latest.status] ?? latest.status : latest.state === 'RUNNING' ? '진행 중' : '결과 없음'}
            </StatusBadge>
          </h3>
          {latest.parentAuditId ? <p>이전 심사를 다시 확인한 재심사입니다.</p> : null}
          {view.diff ? (
            <div role="group" aria-label="이전 심사와 비교">
              <h3>이전 심사와 비교</h3>
              <p>
                고쳐짐 {view.diff.fixed.length}건 · 그대로 {view.diff.remaining.length}건 · 새로 발견 {view.diff.added.length}건
              </p>
              {(['fixed', 'remaining', 'added'] as const).map((k) =>
                view.diff![k].length > 0 ? (
                  <details key={k}>
                    <summary>{k === 'fixed' ? '고쳐짐' : k === 'remaining' ? '그대로' : '새로 발견'}</summary>
                    <ul className={styles.resultList}>
                      {view.diff![k].map((d) => (
                        <li key={`${d.rule}|${d.viewport}|${d.path}`}>
                          {VIEWPORT_LABEL[d.viewport] ?? d.viewport} · {d.path ?? '-'} · {d.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null,
              )}
              <p>다시 확인하지 못한 화면의 문제는 “고쳐짐”으로 세지 않습니다.</p>
            </div>
          ) : null}
          {stop ? <p role="note">{stop}</p> : null}
          {guidance.map((g) => (
            <p key={g} role="note">
              {g}
            </p>
          ))}
          {errorScreens.length > 0 ? (
            <div role="group" aria-label="오류 화면">
              <h3>오류 화면이 나온 화면</h3>
              <p role="note">{ERROR_SCREEN_NOTE}</p>
              <div className={styles.resultTableWrap}>
                <table className={styles.resultTable}>
                  <thead>
                    <tr>
                      <th scope="col">화면</th>
                      <th scope="col">경로</th>
                      <th scope="col">결과</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errorScreens.map((e) => (
                      <tr key={`${e.viewport}-${e.path}`}>
                        <td>{VIEWPORT_LABEL[e.viewport] ?? e.viewport}</td>
                        <td>{e.path}</td>
                        <td><StatusBadge status="BLOCKED" title="ERROR_SCREEN">오류 화면 · 측정 안 함</StatusBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <BlockedRequestsTable details={latest.blocked} total={latest.blockedCount} highlightPages={errorScreens.map((e) => e.path)} classes={{ wrap: styles.resultTableWrap, table: styles.resultTable, muted: styles.muted }} />
          {rows.length > 0 ? (
            <div className={styles.resultTableWrap}>
            <table className={styles.resultTable}>
              <thead>
                <tr>
                  <th scope="col">화면</th>
                  <th scope="col">영역</th>
                  <th scope="col">결과</th>
                  <th scope="col" className={styles.num}>발견</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.viewport}-${r.area}`}>
                    <td>{VIEWPORT_LABEL[r.viewport] ?? r.viewport}</td>
                    <td>{AREA_LABEL[r.area] ?? r.area}</td>
                    <td><StatusBadge status={r.status} title={r.status}>{STATUS_LABEL[r.status] ?? r.status}</StatusBadge></td>
                    <td className={styles.num}>{r.findings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : null}
          {findings.length > 0 ? (
            <>
              <h3>발견한 문제</h3>
              <ul className={styles.findingList}>
                {findings.map((f) => (
                  <li key={f.id}>
                    <StatusBadge tone={f.severity === 'HIGH' ? 'fail' : f.severity === 'MEDIUM' ? 'partial' : 'neutral'} title={f.severity}>{SEVERITY_LABEL[f.severity] ?? f.severity}</StatusBadge>
                    {VIEWPORT_LABEL[f.viewport] ?? f.viewport} · {f.path ?? '-'} · {f.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {latest.shots.some((s) => s.url) ? (
            <>
              <h3>가린 스크린샷 (5분 동안 열림)</h3>
              <div className={styles.shotGrid}>
                {latest.shots
                  .filter((s) => s.url)
                  .map((s) => (
                    <figure key={s.id} style={{ maxWidth: s.viewport === 'MOBILE' ? 195 : 340 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url!} alt={`${s.path} ${VIEWPORT_LABEL[s.viewport] ?? s.viewport} 화면 (개인정보 가림)`} />
                      <figcaption>
                        {s.path} · {VIEWPORT_LABEL[s.viewport] ?? s.viewport}
                      </figcaption>
                    </figure>
                  ))}
              </div>
            </>
          ) : null}
          {latest.state !== 'RUNNING' ? (
            <ScreenAuditRunButton connectionId={props.connectionId} parentAuditId={latest.id} label="재심사 (같은 화면 다시 확인)" variant="secondary" icon="recheck" action={runScreenAuditAction} />
          ) : null}
        </>
      ) : (
        <p className={styles.muted}>아직 화면 심사 기록이 없습니다.</p>
      )}
      {view.history.length > 0 ? (
        <>
          <h3>이전 심사</h3>
          <ul className={styles.resultList}>
            {view.history.map((h) => (
              <li key={h.id}>
                {formatKst(h.createdAt)} · {h.status ? STATUS_LABEL[h.status] ?? h.status : h.state}
                {h.parentAuditId ? ' · 재심사' : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
