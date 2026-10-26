'use client';

import * as React from 'react';
import { READONLY_ACCOUNT_CONSENT_TEXT } from '@/lib/jury-product/services/readonly-account/consent-text';

export type ReadOnlyAccountCredentialFormProps = {
  connectionId: string;
  enabled: boolean;
  consentAccepted?: boolean;
  stored?: { usernameHint: string; expiresAt: string } | null;
  consentAction?: (formData: FormData) => void | Promise<void>;
  credentialAction?: (formData: FormData) => void | Promise<void>;
  classes?: { root?: string; notice?: string; input?: string; button?: string };
};

export function formatKst(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} KST`;
}

export function ReadOnlyAccountCredentialForm(props: ReadOnlyAccountCredentialFormProps) {
  const id = React.useId();
  const [consented, setConsented] = React.useState(Boolean(props.consentAccepted));
  const classes = props.classes ?? {};
  const inputsDisabled = !props.enabled || !consented;
  return (
    <section className={classes.root} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>읽기 전용 계정 연결</h3>
      {!props.enabled ? <p className={classes.notice} role="status">준비 중인 기능입니다. 아직 계정 정보를 저장할 수 없습니다.</p> : null}
      <form action={props.consentAction}>
        <input type="hidden" name="connectionId" value={props.connectionId} />
        <ul>
          {READONLY_ACCOUNT_CONSENT_TEXT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <label htmlFor={`${id}-origins`}>허용 도메인 (한 줄에 하나, https)</label>
        <textarea id={`${id}-origins`} name="allowedOrigins" className={classes.input} disabled={!props.enabled || props.consentAccepted} />
        <label htmlFor={`${id}-paths`}>관찰 경로 (한 줄에 하나)</label>
        <textarea id={`${id}-paths`} name="paths" className={classes.input} disabled={!props.enabled || props.consentAccepted} />
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
          <button type="submit" className={classes.button} disabled={!props.enabled || !consented}>
            동의 저장
          </button>
        ) : null}
      </form>
      <form action={props.credentialAction} autoComplete="off">
        <input type="hidden" name="connectionId" value={props.connectionId} />
        {props.stored ? (
          <p role="status">
            저장됨 ({props.stored.usernameHint}), 만료 {formatKst(props.stored.expiresAt)}
          </p>
        ) : null}
        <label htmlFor={`${id}-user`}>아이디</label>
        <input id={`${id}-user`} name="username" type="text" autoComplete="off" className={classes.input} disabled={inputsDisabled} />
        <label htmlFor={`${id}-pass`}>비밀번호</label>
        <input id={`${id}-pass`} name="password" type="password" autoComplete="new-password" className={classes.input} disabled={inputsDisabled} />
        <button type="submit" className={classes.button} disabled={inputsDisabled || !props.consentAccepted}>
          {props.stored ? '교체 저장' : '암호화 저장'}
        </button>
      </form>
    </section>
  );
}
