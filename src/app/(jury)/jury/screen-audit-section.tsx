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
} from '@/lib/jury-product/services/screen-audit/view-model';
import styles from './jury.module.css';
import { runScreenAuditAction } from './screen-audit-actions';
import { ScreenAuditRunButton } from './ScreenAuditRunButton';

export async function ScreenAuditSection(props: { tenantId: string; connectionId: string; accessMethod: string | null | undefined }) {
  if (!shouldShowReadonlyAccountSection({ uiEnabled: READONLY_ACCOUNT_UI_ENABLED, accessMethod: props.accessMethod })) {
    return (
      <section className={styles.panel}>
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
  const findings = latest ? [...latest.findings].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)) : [];
  return (
    <section className={styles.panel} aria-labelledby="screen-audit-title">
      <h2 id="screen-audit-title">화면 심사</h2>
      <ul>
        {SCREEN_AUDIT_NOTES.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <ScreenAuditRunButton connectionId={props.connectionId} label={latest ? '새로 심사' : '화면 심사 시작'} action={runScreenAuditAction} />
      {latest ? (
        <>
          <h3>
            최근 심사 · {formatKst(latest.createdAt)} · {latest.status ? STATUS_LABEL[latest.status] ?? latest.status : latest.state === 'RUNNING' ? '진행 중' : '결과 없음'}
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
                    <ul>
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
          {rows.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th scope="col">화면</th>
                  <th scope="col">영역</th>
                  <th scope="col">결과</th>
                  <th scope="col">발견</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.viewport}-${r.area}`}>
                    <td>{VIEWPORT_LABEL[r.viewport] ?? r.viewport}</td>
                    <td>{AREA_LABEL[r.area] ?? r.area}</td>
                    <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                    <td>{r.findings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {findings.length > 0 ? (
            <>
              <h3>발견한 문제</h3>
              <ul>
                {findings.map((f) => (
                  <li key={f.id}>
                    [{SEVERITY_LABEL[f.severity] ?? f.severity}] {VIEWPORT_LABEL[f.viewport] ?? f.viewport} · {f.path ?? '-'} · {f.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {latest.shots.some((s) => s.url) ? (
            <>
              <h3>가린 스크린샷 (5분 동안 열림)</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {latest.shots
                  .filter((s) => s.url)
                  .map((s) => (
                    <figure key={s.id} style={{ margin: 0, maxWidth: s.viewport === 'MOBILE' ? 195 : 340 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url!} alt={`${s.path} ${VIEWPORT_LABEL[s.viewport] ?? s.viewport} 화면 (개인정보 가림)`} style={{ width: '100%', border: '1px solid #ddd' }} />
                      <figcaption>
                        {s.path} · {VIEWPORT_LABEL[s.viewport] ?? s.viewport}
                      </figcaption>
                    </figure>
                  ))}
              </div>
            </>
          ) : null}
          {latest.state !== 'RUNNING' ? (
            <ScreenAuditRunButton connectionId={props.connectionId} parentAuditId={latest.id} label="재심사 (같은 화면 다시 확인)" action={runScreenAuditAction} />
          ) : null}
        </>
      ) : (
        <p>아직 화면 심사 기록이 없습니다.</p>
      )}
      {view.history.length > 0 ? (
        <>
          <h3>이전 심사</h3>
          <ul>
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
