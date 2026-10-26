import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { currentReadonlyStep, ReadOnlyAccountCredentialForm, scopeSummaryText } from './ReadOnlyAccountCredentialForm';

const scope = { allowedOrigins: ['https://app.example.com', 'https://b.example.com'], authOrigins: [], paths: ['/a', '/b'] };
const login = { loginUrl: 'https://app.example.com/login', usernameSelector: '#email', passwordSelector: '#password', submitSelector: 'button[type=submit]', successPathPrefix: '/' };
const stored = { usernameHint: 'ab***', expiresAt: '2026-11-09T03:00:00.000Z' };
const classes = { pillDone: 'done', pillCurrent: 'cur', pillLocked: 'lock', primary: 'primary', big: 'big', required: 'req', optional: 'opt' };
const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(ReadOnlyAccountCredentialForm, { connectionId: 'c1', enabled: true, mode: 'stepper', classes, ...props }));
const count = (html: string, re: RegExp) => (html.match(new RegExp(re.source, 'g')) ?? []).length;

test('current step follows stored scope, credential and login plan', () => {
  assert.equal(currentReadonlyStep({}), 1);
  assert.equal(currentReadonlyStep({ scope }), 2);
  assert.equal(currentReadonlyStep({ scope, stored }), 2);
  assert.equal(currentReadonlyStep({ scope, stored, login }), 3);
  assert.equal(scopeSummaryText(scope), 'https://app.example.com 외 1개 · 관찰 경로 2개');
});

test('step 1: only the scope form is expanded; pills show current/locked', () => {
  const html = render();
  assert.match(html, /name="allowedOrigins"/);
  assert.match(html, /name="consent"/);
  assert.doesNotMatch(html, /name="username"|name="loginUrl"|관찰 실행<\/button>/);
  assert.match(html, /class="cur"[^>]*>① 범위/);
  assert.match(html, /class="lock"[^>]*>② 계정/);
  assert.match(html, /허용 도메인<span class="req">필수/);
  assert.match(html, /인증 서버<span class="opt">선택/);
  assert.match(html, /관찰 경로<span class="opt">선택/);
  assert.equal(count(html, /class="primary"/), 1);
});

test('step 2: scope collapses to a summary with 수정; login URL, id, password required; selectors under 고급', () => {
  const html = render({ consentAccepted: true, scope });
  assert.match(html, /✓ https:\/\/app.example.com 외 1개 · 관찰 경로 2개/);
  assert.match(html, />수정<\/button>/);
  assert.doesNotMatch(html, /name="allowedOrigins"/);
  assert.match(html, /class="done"[^>]*>✓ ① 범위/);
  assert.match(html, /class="cur"[^>]*>② 계정/);
  assert.match(html, /로그인 주소<span class="req">필수/);
  assert.match(html, /아이디<span class="req">필수/);
  assert.match(html, /비밀번호<span class="req">필수/);
  assert.match(html, /<details><summary>고급 \(로그인 화면 선택자\)<\/summary>/);
  assert.equal(count(html, /class="primary"/), 1);
  assert.doesNotMatch(html, /name="loginOnly"/);
});

test('step 2 with a credential but no login plan (after re-consent) allows saving only the login URL', () => {
  const html = render({ consentAccepted: true, scope, stored });
  assert.match(html, /name="loginOnly" value="1"/);
  assert.match(html, /비워 두면 저장된 계정\(ab\*\*\*\)을 그대로 써요/);
});

test('step 3: one big primary 관찰 실행 button, no scope or login inputs, summaries with 교체', () => {
  const html = render({ consentAccepted: true, scope, stored, login });
  assert.match(html, /<button type="submit" class="primary big"[^>]*>▶ 관찰 실행<\/button>/);
  assert.doesNotMatch(html, /name="allowedOrigins"|name="loginUrl"|name="password"/);
  assert.match(html, /계정 ab\*\*\* · 만료 2026-11-09 12:00 KST · 로그인 https:\/\/app.example.com\/login/);
  assert.match(html, />교체<\/button>/);
  assert.match(html, /id="observe"/);
  assert.equal(count(html, /class="primary/), 1);
});

test('latest run summary links to 관찰 결과 보기', () => {
  const latestRun = { id: 'r', ok: true, stop: null, challenge: null, loginAttempts: 1, pagesObserved: 4, pagesVisible: 4, pages: [], blockedRequestCount: 0, blockedByReason: { ORIGIN: 0, METHOD: 0, FORM_SUBMIT: 0, LOGIN_ALREADY_USED: 0 }, finalOrigin: null, finalPath: null, observedAt: '2026-10-26T03:00:00.000Z' };
  const html = render({ consentAccepted: true, scope, stored, login, latestRun });
  assert.match(html, /관찰 페이지 4개/);
  assert.match(html, /href="\/jury\/services\/c1\?tab=results"[^>]*>관찰 결과 보기/);
});

test('legacy consents (no stored scope) keep the re-entry form with a one-time re-consent offer', () => {
  const html = render({ mode: 'legacy', consentAccepted: true, stored });
  assert.match(html, /name="allowedOrigins"/);
  assert.match(html, /범위 다시 동의하기/);
  assert.doesNotMatch(render({ mode: 'legacy' }), /범위 다시 동의하기/);
});

test('header next action, DEGRADED warning badge and route wording', async () => {
  const { observationTakesPriority, reasonDisplay } = await import('@/lib/jury-product/services/readonly-account/flow');
  const m = (id: string) => ({ next: { id, label: 'Collect evidence', state: 'AVAILABLE' } }) as never;
  assert.equal(observationTakesPriority(m('collect-evidence'), true), true);
  assert.equal(observationTakesPriority(m('collect-evidence'), false), false);
  assert.equal(observationTakesPriority(m('discover'), true), false);
  const ui = readFileSync('src/app/(jury)/jury/service-operations-ui.tsx', 'utf8');
  assert.match(ui, /tab=connect#observe/);
  assert.match(ui, /className=\{badgeClass\(model.health\)\}/);
  const css = readFileSync('src/app/(jury)/jury/jury.module.css', 'utf8');
  assert.match(css, /\.badgeWarn/);
  assert.equal(reasonDisplay('화면 route 후보. 측정하지 않음.'), '화면 경로 후보. 측정하지 않음.');
  assert.doesNotMatch(readFileSync('src/lib/jury-product/discovery.ts', 'utf8'), /화면 route/);
});

test('section picks legacy only for consents without stored scope', async () => {
  const { readonlySectionMode } = await import('@/lib/jury-product/services/readonly-account/flow');
  assert.equal(readonlySectionMode({ consentAccepted: false, scope: null }), 'stepper');
  assert.equal(readonlySectionMode({ consentAccepted: true, scope: null }), 'stepper');
  assert.equal(readonlySectionMode({ consentAccepted: true, scope }), 'stepper');
});

test('t494: re-consent reopens ① with fields, checkbox and 동의 저장 as the current step', async () => {
  const { consentStepDone, reconsentNeeded, resultNeedsReconsent } = await import('@/lib/jury-product/services/readonly-account/flow');
  // done only with current consent + hash-verified stored scope + no stale/required result
  assert.equal(consentStepDone({ consentAccepted: true, scope }), true);
  assert.equal(consentStepDone({ consentAccepted: true, scope: null }), false); // no stored scope / hash mismatch / old version
  assert.equal(consentStepDone({ consentAccepted: false, scope: null }), false);
  assert.equal(consentStepDone({ consentAccepted: true, scope }, [{ ok: false, reason: 'CONSENT_STALE' }]), false);
  assert.equal(consentStepDone({ consentAccepted: true, scope }, [{ ok: false, reason: 'CONSENT_REQUIRED' }]), false);
  assert.equal(consentStepDone({ consentAccepted: true, scope }, [{ ok: false, reason: 'LOGIN_FAILED' }]), true);
  assert.equal(resultNeedsReconsent({ ok: true }), false);
  assert.equal(reconsentNeeded({ consentAccepted: true, scope: null }), true);
  assert.equal(reconsentNeeded({ consentAccepted: false, scope: null }), false);
  assert.equal(currentReadonlyStep({ scope, stored, login, reconsent: true }), 1);

  for (const props of [
    { consentAccepted: true, scope: null, stored }, // current version, scope not stored (pre-I-054) or hash mismatch
    { consentAccepted: false, hadConsent: true, scope: null, stored, login }, // outdated consent version
  ]) {
    const html = render(props);
    assert.match(html, /name="allowedOrigins"/);
    assert.match(html, /name="consent"/);
    assert.match(html, /동의 저장<\/button>/);
    assert.match(html, /class="cur"[^>]*>① 범위/);
    assert.doesNotMatch(html, /동의 완료 ✓/);
    assert.match(html, /다시 동의가 필요해요/);
    assert.doesNotMatch(html, /name="username"/);
  }
});

test('t494: section always uses the stepper and loads consent of any version', () => {
  const src = readFileSync(new URL('./readonly-account-section.tsx', import.meta.url), 'utf8');
  assert.match(src, /where: \{ tenantId, connectionId \}/);
  assert.match(src, /consentAccepted: consent\?\.version === READONLY_ACCOUNT_CONSENT_VERSION/);
});
