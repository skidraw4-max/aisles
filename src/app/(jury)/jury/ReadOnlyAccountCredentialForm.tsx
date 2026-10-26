'use client';

import * as React from 'react';
import { READONLY_ACCOUNT_CONSENT_TEXT } from '@/lib/jury-product/services/readonly-account/consent-text';
import {
  readonlyAccountReasonText,
  readonlyAccountStopText,
  type ReadonlyAccountFormAction,
  type ReadonlyAccountFormResult,
} from '@/lib/jury-product/services/readonly-account/result-text';

export type { ReadonlyAccountFormAction, ReadonlyAccountFormResult };

export type ReadOnlyAccountCredentialFormProps = {
  connectionId: string;
  enabled: boolean;
  consentAccepted?: boolean;
  stored?: { usernameHint: string; expiresAt: string } | null;
  consentAction?: ReadonlyAccountFormAction;
  credentialAction?: ReadonlyAccountFormAction;
  observationAction?: ReadonlyAccountFormAction;
  classes?: { root?: string; notice?: string; input?: string; button?: string };
};

export function formatKst(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} KST`;
}

const noop: ReadonlyAccountFormAction = () => null;

export function resultText(result: ReadonlyAccountFormResult | null, okText: string): string | null {
  if (!result) return null;
  if (!result.ok) return readonlyAccountReasonText(result.reason);
  if (!result.summary) return okText;
  const s = result.summary;
  return `${readonlyAccountStopText(s.stop)} 관찰 페이지 ${s.pagesObserved}개, 차단된 요청 ${s.blockedRequestCount}건`;
}

function ScopeFields(props: { id: string; inputClass?: string; disabled: boolean }) {
  return (
    <>
      <label htmlFor={`${props.id}-origins`}>허용 도메인 (한 줄에 하나, https)</label>
      <textarea id={`${props.id}-origins`} name="allowedOrigins" className={props.inputClass} disabled={props.disabled} />
      <label htmlFor={`${props.id}-auth`}>인증 서버 도메인 (선택, 한 줄에 하나, https · 예: Supabase 프로젝트 주소)</label>
      <textarea id={`${props.id}-auth`} name="authOrigins" className={props.inputClass} disabled={props.disabled} />
      <label htmlFor={`${props.id}-paths`}>관찰 경로 (한 줄에 하나)</label>
      <textarea id={`${props.id}-paths`} name="paths" className={props.inputClass} disabled={props.disabled} />
    </>
  );
}

export function ReadOnlyAccountCredentialForm(props: ReadOnlyAccountCredentialFormProps) {
  const id = React.useId();
  const [consented, setConsented] = React.useState(Boolean(props.consentAccepted));
  const [consentResult, consentFormAction, consentPending] = React.useActionState(props.consentAction ?? noop, null);
  const [credentialResult, credentialFormAction, credentialPending] = React.useActionState(props.credentialAction ?? noop, null);
  const [observationResult, observationFormAction, observationPending] = React.useActionState(props.observationAction ?? noop, null);
  const classes = props.classes ?? {};
  const inputsDisabled = !props.enabled || !consented;
  const consentMessage = resultText(consentResult, '동의를 저장했습니다.');
  const credentialMessage = resultText(credentialResult, '계정 정보를 암호화해 저장했습니다.');
  const observationMessage = resultText(observationResult, '관찰을 완료했습니다.');
  return (
    <section className={classes.root} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>읽기 전용 계정 연결</h3>
      {!props.enabled ? <p className={classes.notice} role="status">준비 중인 기능입니다. 아직 계정 정보를 저장할 수 없습니다.</p> : null}
      <form action={consentFormAction}>
        <input type="hidden" name="connectionId" value={props.connectionId} />
        <ul>
          {READONLY_ACCOUNT_CONSENT_TEXT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <ScopeFields id={`${id}-consent`} inputClass={classes.input} disabled={!props.enabled || Boolean(props.consentAccepted)} />
        <label>
          <input
            type="checkbox"
            name="consent"
            checked={consented}
            disabled={!props.enabled || props.consentAccepted}
            onChange={(event) => setConsented(event.target.checked)}
          />
          위 내용을 확인했으며 동의합니다
        </label>
        {!props.consentAccepted ? (
          <button type="submit" className={classes.button} disabled={!props.enabled || !consented || consentPending}>
            동의 저장
          </button>
        ) : null}
        {consentMessage ? <p role="status">{consentMessage}</p> : null}
      </form>
      <form action={credentialFormAction} autoComplete="off">
        <input type="hidden" name="connectionId" value={props.connectionId} />
        {props.stored ? (
          <p role="status">
            저장됨 ({props.stored.usernameHint}), 만료 {formatKst(props.stored.expiresAt)}
          </p>
        ) : null}
        <p>동의한 허용 도메인, 인증 서버 도메인, 관찰 경로를 같은 내용으로 입력해 주세요.</p>
        <ScopeFields id={`${id}-cred`} inputClass={classes.input} disabled={inputsDisabled} />
        <label htmlFor={`${id}-user`}>아이디</label>
        <input id={`${id}-user`} name="username" type="text" autoComplete="off" className={classes.input} disabled={inputsDisabled} />
        <label htmlFor={`${id}-pass`}>비밀번호</label>
        <input id={`${id}-pass`} name="password" type="password" autoComplete="new-password" className={classes.input} disabled={inputsDisabled} />
        <button type="submit" className={classes.button} disabled={inputsDisabled || !props.consentAccepted || credentialPending}>
          {props.stored ? '교체 저장' : '암호화 저장'}
        </button>
        {credentialMessage ? <p role="status">{credentialMessage}</p> : null}
      </form>
      {props.stored ? (
        <form action={observationFormAction} autoComplete="off">
          <input type="hidden" name="connectionId" value={props.connectionId} />
          <h4>읽기 전용 관찰 실행</h4>
          <p>저장된 계정으로 한 번 로그인한 뒤 관찰 경로를 조회만 합니다. 입력·수정·삭제 요청은 차단됩니다.</p>
          <ScopeFields id={`${id}-obs`} inputClass={classes.input} disabled={!props.enabled} />
          <label htmlFor={`${id}-login`}>로그인 주소 (https)</label>
          <input id={`${id}-login`} name="loginUrl" type="url" className={classes.input} disabled={!props.enabled} />
          <label htmlFor={`${id}-usel`}>아이디 입력란 선택자</label>
          <input id={`${id}-usel`} name="usernameSelector" type="text" className={classes.input} disabled={!props.enabled} />
          <label htmlFor={`${id}-psel`}>비밀번호 입력란 선택자</label>
          <input id={`${id}-psel`} name="passwordSelector" type="text" className={classes.input} disabled={!props.enabled} />
          <label htmlFor={`${id}-ssel`}>로그인 버튼 선택자</label>
          <input id={`${id}-ssel`} name="submitSelector" type="text" className={classes.input} disabled={!props.enabled} />
          <label htmlFor={`${id}-succ`}>로그인 성공 경로 접두어</label>
          <input id={`${id}-succ`} name="successPathPrefix" type="text" defaultValue="/" className={classes.input} disabled={!props.enabled} />
          <button type="submit" className={classes.button} disabled={!props.enabled || observationPending}>
            관찰 실행
          </button>
          {observationMessage ? <p role="status">{observationMessage}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
