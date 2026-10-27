'use client';
import * as React from 'react';
import type { connectGa4ViewerAction, issueOwnershipTokenAction, verifyOwnershipAction } from './phase1-actions';
import { PHASE1_REASON_TEXT, OWNERSHIP_STATUS_TEXT } from '@/lib/jury-product/services/phase1-text';

function reasonText(reason: string): string {
  return PHASE1_REASON_TEXT[reason] ?? `처리하지 못했어요 (${reason}).`;
}

export function OwnershipIssueForm(props: { connectionId: string; defaultHost: string; consentText: readonly string[]; action: typeof issueOwnershipTokenAction }) {
  const [result, formAction, pending] = React.useActionState(props.action, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="connectionId" value={props.connectionId} />
      <label>
        사이트 주소(도메인) <input name="host" defaultValue={props.defaultHost} required />
      </label>
      <fieldset>
        <legend>확인 방법</legend>
        <label><input type="radio" name="method" value="DNS_TXT" defaultChecked /> DNS TXT 레코드</label>
        <label><input type="radio" name="method" value="META_TAG" /> 첫 페이지 meta 태그</label>
        <label><input type="radio" name="method" value="WELL_KNOWN_FILE" /> /.well-known 파일</label>
      </fieldset>
      <ul>{props.consentText.map((t) => <li key={t}>{t}</li>)}</ul>
      <label><input type="checkbox" name="consent" required /> 위 내용에 동의해요.</label>
      <button type="submit" disabled={pending}>{pending ? '발급 중…' : '확인 값 발급'}</button>
      {result ? (
        result.ok ? (
          <div role="status">
            <p>{result.host}에 아래 값을 추가한 뒤 “지금 확인”을 눌러 주세요. 이 값은 지금 한 번만 보여 드려요.</p>
            <p>위치: <code>{result.where}</code></p>
            <p>값: <code>{result.value}</code></p>
          </div>
        ) : (
          <p role="status">{reasonText(result.reason)}</p>
        )
      ) : null}
    </form>
  );
}

export function OwnershipVerifyButton(props: { connectionId: string; verificationId: string; action: typeof verifyOwnershipAction }) {
  const [result, formAction, pending] = React.useActionState(props.action, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="connectionId" value={props.connectionId} />
      <input type="hidden" name="verificationId" value={props.verificationId} />
      <button type="submit" disabled={pending}>{pending ? '확인 중…' : '지금 확인'}</button>
      {result ? (
        <p role="status">
          {result.ok
            ? `${OWNERSHIP_STATUS_TEXT[result.status] ?? result.status}${result.failureCode ? ` (${reasonText(result.failureCode)})` : ''}`
            : reasonText(result.reason)}
        </p>
      ) : null}
    </form>
  );
}

export function Ga4ConnectForm(props: { connectionId: string; consentText: readonly string[]; defaultPropertyId: string; action: typeof connectGa4ViewerAction }) {
  const [result, formAction, pending] = React.useActionState(props.action, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="connectionId" value={props.connectionId} />
      <label>
        GA4 속성 ID <input name="propertyId" inputMode="numeric" defaultValue={props.defaultPropertyId} required />
      </label>
      <ul>{props.consentText.map((t) => <li key={t}>{t}</li>)}</ul>
      <label><input type="checkbox" name="consent" required /> 위 내용에 동의해요.</label>
      <button type="submit" disabled={pending}>{pending ? '확인 중…' : '권한 확인 후 연결'}</button>
      {result ? <p role="status">{result.ok ? `연결했어요. 속성 ${result.propertyId}의 지표를 읽을 수 있어요.` : reasonText(result.reason)}</p> : null}
    </form>
  );
}
