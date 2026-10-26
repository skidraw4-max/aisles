'use client';

import * as React from 'react';
import { READONLY_ACCOUNT_CONSENT_TEXT } from '@/lib/jury-product/services/readonly-account/consent-text';
import {
  readonlyAccountReasonText,
  readonlyAccountStopText,
  withClientDeadline,
  type ReadonlyAccountFormAction,
  type ReadonlyAccountFormResult,
} from '@/lib/jury-product/services/readonly-account/result-text';
import type { LatestObservationRun } from '@/lib/jury-product/services/readonly-account/latest-observation';
import {
  AUTH_ORIGIN_HELP,
  BLOCKED_REQUESTS_NOTE,
  CREDENTIAL_RETENTION_NOTE,
  SELECTOR_HELP,
  OBSERVATION_PATHS_HELP,
  AUTO_DISCOVERY_NOTE,
  DISCOVERED_PAGE_BADGE,
} from '@/lib/jury-product/connected-service-copy';

export type { ReadonlyAccountFormAction, ReadonlyAccountFormResult };

export type ReadOnlyAccountCredentialFormProps = {
  connectionId: string;
  enabled: boolean;
  consentAccepted?: boolean;
  stored?: { usernameHint: string; expiresAt: string } | null;
  consentAction?: ReadonlyAccountFormAction;
  credentialAction?: ReadonlyAccountFormAction;
  observationAction?: ReadonlyAccountFormAction;
  /** I-047: most recent persisted observation summary. */
  latestRun?: LatestObservationRun | null;
  /** I-051: field/step/badge classes come from the server section (client file stays CSS-import free for node tests). */
  classes?: {
    root?: string;
    notice?: string;
    input?: string;
    button?: string;
    field?: string;
    help?: string;
    required?: string;
    optional?: string;
    step?: string;
    steps?: string;
    badge?: string;
  };
};

export function formatKst(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} KST`;
}

const noop: ReadonlyAccountFormAction = () => null;

export function LatestObservationResult(props: { run: LatestObservationRun | null | undefined }) {
  const run = props.run;
  return (
    <div>
      <h4>최근 관찰 결과</h4>
      {!run ? (
        <p>아직 저장된 관찰 결과가 없어요.</p>
      ) : (
        <>
          <p>
            {formatKst(run.observedAt)} · {run.ok ? '성공' : '중단'} · {readonlyAccountStopText(run.stop)}
          </p>
          <p>
            관찰 페이지 {run.pagesObserved}개 (내용 확인 {run.pagesVisible}개) · 차단된 요청 {run.blockedRequestCount}건 (도메인 {run.blockedByReason.ORIGIN}, 메서드{' '}
            {run.blockedByReason.METHOD}, 폼 제출 {run.blockedByReason.FORM_SUBMIT}, 재로그인 {run.blockedByReason.LOGIN_ALREADY_USED})
          </p>
          <p>{BLOCKED_REQUESTS_NOTE}</p>
          <p>이 결과는 [자료 수집]을 다시 실행해야 검증 근거에 반영돼요.</p>
          {run.finalOrigin ? (
            <p>
              마지막 위치: {run.finalOrigin}
              {run.finalPath ?? ''}
            </p>
          ) : null}
          {run.pages.length > 0 ? (
            <ul>
              {run.pages.map((p, i) => (
                <li key={`${p.path}-${i}`}>
                  {p.discovered ? `[${DISCOVERED_PAGE_BADGE}] ` : ''}
                  {p.label} ({p.path}) · {p.visible ? '내용 있음' : '내용 없음'} · 글자 수 {p.textLength}
                  {p.stats ? ` · 목록 ${p.stats.listItems} · 카드 ${p.stats.cards} · 표 행 ${p.stats.tableRows} · 제목 ${p.stats.headings}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

export function resultText(result: ReadonlyAccountFormResult | null, okText: string): string | null {
  if (!result) return null;
  if (!result.ok) return readonlyAccountReasonText(result.reason);
  if (!result.summary) return okText;
  const s = result.summary;
  return `${readonlyAccountStopText(s.stop)} 관찰 페이지 ${s.pagesObserved}개, 차단된 요청 ${s.blockedRequestCount}건`;
}

/** I-051: login-related failures open the 로그인 설정 (고급) section automatically. */
export function isLoginFailure(result: ReadonlyAccountFormResult | null): boolean {
  if (!result) return false;
  if (!result.ok) return result.reason.startsWith('LOGIN_') || result.reason === 'CHALLENGE_REQUIRED';
  return Boolean(result.summary?.stop?.startsWith('LOGIN_'));
}

type FieldClasses = NonNullable<ReadOnlyAccountCredentialFormProps['classes']>;

type FieldProps = {
  c: FieldClasses;
  id: string;
  label: string;
  required: boolean;
  help: string;
  children: React.ReactElement<{ id?: string; 'aria-describedby'?: string }>;
};

/** Label + 필수/선택 badge, the input, then one helper line. */
function Field(props: FieldProps) {
  const helpId = `${props.id}-help`;
  return (
    <div className={props.c.field}>
      <label htmlFor={props.id}>
        {props.label}
        <span className={props.required ? props.c.required : props.c.optional}>{props.required ? '필수' : '선택'}</span>
      </label>
      {React.cloneElement(props.children, { id: props.id, 'aria-describedby': helpId })}
      <p id={helpId} className={props.c.help}>
        {props.help}
      </p>
    </div>
  );
}

function StepState(props: { done: boolean; active: boolean; className?: string }) {
  if (props.done) return <span className={props.className}>완료 ✓</span>;
  return <span className={props.className}>{props.active ? '진행' : '대기'}</span>;
}

/**
 * I-051: one form, three steps (① 범위 동의 → ② 계정 저장 → ③ 관찰 실행).
 * Scope fields appear once and are submitted with every step button (button formAction),
 * so the server still re-checks the consented scope hash. No server action or validation changes.
 */
export function ReadOnlyAccountCredentialForm(props: ReadOnlyAccountCredentialFormProps) {
  const id = React.useId();
  const [consented, setConsented] = React.useState(Boolean(props.consentAccepted));
  const [editingCredential, setEditingCredential] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [consentResult, consentFormAction, consentPending] = React.useActionState(props.consentAction ?? noop, null);
  const [credentialResult, credentialFormAction, credentialPending] = React.useActionState(props.credentialAction ?? noop, null);
  const observationWithDeadline = React.useMemo(() => withClientDeadline(props.observationAction ?? noop), [props.observationAction]);
  const [observationResult, observationFormAction, observationPending] = React.useActionState(observationWithDeadline, null);
  React.useEffect(() => {
    if (isLoginFailure(observationResult)) setAdvancedOpen(true);
  }, [observationResult]);
  React.useEffect(() => {
    if (credentialResult?.ok) setEditingCredential(false);
  }, [credentialResult]);
  const classes = props.classes ?? {};
  const enabled = props.enabled;
  const consentDone = Boolean(props.consentAccepted);
  const stored = props.stored ?? null;
  const credentialOpen = !stored || editingCredential;
  const credentialInputsDisabled = !enabled || !consented;
  const consentMessage = resultText(consentResult, '동의를 저장했어요.');
  const credentialMessage = resultText(credentialResult, '계정 정보를 암호화해 저장했어요.');
  const observationMessage = resultText(observationResult, '관찰을 완료했어요.');
  const input = classes.input;
  return (
    <section className={classes.root} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>읽기 전용 계정 연결</h3>
      {!enabled ? <p className={classes.notice} role="status">준비 중인 기능이에요. 아직 계정 정보를 저장할 수 없어요.</p> : null}
      <ol className={classes.steps} aria-label="진행 단계">
        <li>① 범위 동의 <StepState className={classes.badge} done={consentDone} active={!consentDone} /></li>
        <li>② 계정 저장 <StepState className={classes.badge} done={Boolean(stored)} active={consentDone && !stored} /></li>
        <li>③ 관찰 실행 <StepState className={classes.badge} done={Boolean(props.latestRun)} active={Boolean(stored)} /></li>
      </ol>
      <form autoComplete="off">
        <input type="hidden" name="connectionId" value={props.connectionId} />

        <fieldset className={classes.step}>
          <legend>관찰 범위</legend>
          {consentDone ? (
            <p className={classes.help}>
              동의는 이미 저장됐어요. 계정을 교체하거나 관찰을 실행할 때만 동의한 범위를 다시 입력하면 돼요. 범위 자체는 저장하지 않고, 동의한 내용과 같은지만 확인해요.
            </p>
          ) : (
            <p className={classes.help}>먼저 관찰할 범위를 입력하고 ① 범위 동의를 저장하세요.</p>
          )}
          <Field c={classes} id={`${id}-origins`} label="허용 도메인" required help="관찰할 서비스 주소. 한 줄에 하나, https만 (최대 10개)">
            <textarea name="allowedOrigins" rows={2} placeholder="https://app.example.com" className={input} disabled={!enabled} />
          </Field>
          <Field c={classes} id={`${id}-auth`} label="인증 서버 도메인" required={false} help={`로그인을 외부 인증 서버에서 처리할 때만 (최대 5개). ${AUTH_ORIGIN_HELP}`}>
            <textarea name="authOrigins" rows={1} placeholder="https://abcd.supabase.co" className={input} disabled={!enabled} />
          </Field>
          <Field c={classes} id={`${id}-paths`} label="관찰 경로" required={false} help={`/로 시작, 한 줄에 하나 (최대 20개). ${OBSERVATION_PATHS_HELP}`}>
            <textarea name="paths" rows={2} placeholder="/dashboard" className={input} disabled={!enabled} />
          </Field>
        </fieldset>

        <fieldset className={classes.step}>
          <legend>① 범위 동의</legend>
          {consentDone ? (
            <p role="status">동의 완료 ✓</p>
          ) : (
            <>
              <details>
                <summary>동의 내용 자세히</summary>
                <ul>
                  {READONLY_ACCOUNT_CONSENT_TEXT.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>
              <label>
                <input type="checkbox" name="consent" checked={consented} disabled={!enabled} onChange={(event) => setConsented(event.target.checked)} />
                위 내용을 확인했고 동의해요 <span className={classes.required}>필수</span>
              </label>
              <button type="submit" formAction={consentFormAction} className={classes.button} disabled={!enabled || !consented || consentPending}>
                동의 저장
              </button>
            </>
          )}
          {consentMessage ? <p role="status">{consentMessage}</p> : null}
        </fieldset>

        <fieldset className={classes.step}>
          <legend>② 계정 저장</legend>
          {stored ? (
            <p role="status">
              저장됨 ({stored.usernameHint}), 만료 {formatKst(stored.expiresAt)}{' '}
              {!editingCredential ? (
                <button type="button" className={classes.button} disabled={!enabled || !consentDone} onClick={() => setEditingCredential(true)}>
                  계정 교체
                </button>
              ) : null}
            </p>
          ) : null}
          {credentialOpen ? (
            <>
              <Field c={classes} id={`${id}-user`} label="아이디" required help="읽기 전용으로 만든 계정의 아이디">
                <input name="username" type="text" autoComplete="off" placeholder="viewer@example.com" className={input} disabled={credentialInputsDisabled} />
              </Field>
              <Field c={classes} id={`${id}-pass`} label="비밀번호" required help="암호화해 저장하고 만료되면 폐기해요">
                <input name="password" type="password" autoComplete="new-password" className={input} disabled={credentialInputsDisabled} />
              </Field>
              <button type="submit" formAction={credentialFormAction} className={classes.button} disabled={credentialInputsDisabled || !consentDone || credentialPending}>
                {stored ? '교체 저장' : '암호화 저장'}
              </button>
              {stored ? (
                <button type="button" className={classes.button} onClick={() => setEditingCredential(false)}>
                  취소
                </button>
              ) : null}
            </>
          ) : null}
          <details>
            <summary>보관 기간 자세히</summary>
            <p>{CREDENTIAL_RETENTION_NOTE}</p>
          </details>
          {credentialMessage ? <p role="status">{credentialMessage}</p> : null}
        </fieldset>

        {stored ? (
          <fieldset className={classes.step}>
            <legend>③ 관찰 실행</legend>
            <Field c={classes} id={`${id}-login`} label="로그인 주소" required help="로그인 화면 주소 (https)">
              <input name="loginUrl" type="url" placeholder="https://app.example.com/login" className={input} disabled={!enabled} />
            </Field>
            <details open={advancedOpen} onToggle={(event) => setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)}>
              <summary>로그인 설정 (고급)</summary>
              <Field c={classes} id={`${id}-usel`} label="아이디 입력란 선택자" required help={SELECTOR_HELP.username}>
                <input name="usernameSelector" type="text" defaultValue="#email" className={input} disabled={!enabled} />
              </Field>
              <Field c={classes} id={`${id}-psel`} label="비밀번호 입력란 선택자" required help={SELECTOR_HELP.password}>
                <input name="passwordSelector" type="text" defaultValue="#password" className={input} disabled={!enabled} />
              </Field>
              <Field c={classes} id={`${id}-ssel`} label="로그인 버튼 선택자" required help={SELECTOR_HELP.submit}>
                <input name="submitSelector" type="text" defaultValue="button[type=submit]" className={input} disabled={!enabled} />
              </Field>
              <Field c={classes} id={`${id}-succ`} label="로그인 성공 경로" required={false} help={SELECTOR_HELP.successPrefix}>
                <input name="successPathPrefix" type="text" placeholder="/dashboard" defaultValue="/" className={input} disabled={!enabled} />
              </Field>
            </details>
            <details>
              <summary>관찰 방식 자세히</summary>
              <p>저장된 계정으로 한 번 로그인한 뒤 관찰 경로와 자동으로 찾은 메뉴를 조회만 해요. 입력·수정·삭제 요청은 차단돼요.</p>
              <p>{AUTO_DISCOVERY_NOTE}</p>
            </details>
            <button type="submit" formAction={observationFormAction} className={classes.button} disabled={!enabled || observationPending}>
              관찰 실행
            </button>
            {observationMessage ? <p role="status">{observationMessage}</p> : null}
            <p className={classes.help}>결과는 [관찰 결과] 탭에서 볼 수 있어요.</p>
          </fieldset>
        ) : null}
      </form>
    </section>
  );
}
