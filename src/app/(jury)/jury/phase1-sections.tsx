/**
 * I-072~I-075: 연결 tab sections. Render nothing unless the matching env flag is on (default off).
 */
import * as React from 'react';
import { ga4ViewerFlags, ownershipFlags } from '@/lib/jury-product/services/phase1-flags';
import { OWNERSHIP_CONSENT_TEXT } from '@/lib/jury-product/services/ownership/consent-text';
import { GA4_VIEWER_CONSENT_TEXT, GA4_VIEWER_STEPS } from '@/lib/jury-product/services/ga4-viewer/consent-text';
import { OWNERSHIP_STATUS_TEXT } from '@/lib/jury-product/services/phase1-text';
import styles from './jury.module.css';
import { connectGa4ViewerAction, issueOwnershipTokenAction, verifyOwnershipAction } from './phase1-actions';
import { Ga4ConnectForm, OwnershipIssueForm, OwnershipVerifyButton } from './phase1-forms';

function kst(d: Date | null): string {
  return d ? d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
}

export async function OwnershipSection(props: { tenantId: string; connectionId: string; accessMethod: string | null | undefined; defaultHost?: string | null }) {
  if (!ownershipFlags().ui || !props.accessMethod || props.accessMethod === 'GA4_VIEWER') return null;
  const { createPrismaOwnershipStore } = await import('@/lib/jury-product/services/ownership/service');
  const rows = await (await createPrismaOwnershipStore()).listForConnection(props.tenantId, props.connectionId).catch(() => []);
  return (
    <section className={styles.panel} aria-labelledby="ownership-title">
      <h2 id="ownership-title">사이트 소유 확인</h2>
      <p>사이트를 운영하는 분인지 확인해요. 확인 후에는 7일마다 자동으로 다시 확인해요.</p>
      {rows.length ? (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              {r.host} · {OWNERSHIP_STATUS_TEXT[r.status] ?? r.status} · 마지막 확인 {kst(r.lastCheckedAt)}
              {r.status === 'PENDING' || r.status === 'FAILED' || r.status === 'EXPIRED' ? (
                <OwnershipVerifyButton connectionId={props.connectionId} verificationId={r.id} action={verifyOwnershipAction} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <OwnershipIssueForm connectionId={props.connectionId} defaultHost={props.defaultHost ?? ''} consentText={OWNERSHIP_CONSENT_TEXT} action={issueOwnershipTokenAction} />
    </section>
  );
}

export function Ga4ViewerSection(props: { connectionId: string; accessMethod: string | null | undefined; propertyId?: string | null }) {
  const flags = ga4ViewerFlags();
  if (!flags.enabled || props.accessMethod !== 'GA4_VIEWER') return null;
  return (
    <section className={styles.panel} aria-labelledby="ga4-viewer-title">
      <h2 id="ga4-viewer-title">GA4 보기 권한 초대</h2>
      <ol>{GA4_VIEWER_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
      {flags.serviceAccountEmail ? <p>서비스 계정 이메일: <code>{flags.serviceAccountEmail}</code></p> : null}
      <Ga4ConnectForm connectionId={props.connectionId} consentText={GA4_VIEWER_CONSENT_TEXT} defaultPropertyId={props.propertyId ?? ''} action={connectGa4ViewerAction} />
    </section>
  );
}
