import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatKst, isLoginFailure, ReadOnlyAccountCredentialForm, resultText } from './ReadOnlyAccountCredentialForm';

const render = (props: Partial<Parameters<typeof ReadOnlyAccountCredentialForm>[0]> = {}) =>
  renderToStaticMarkup(createElement(ReadOnlyAccountCredentialForm, { connectionId: 'c1', enabled: true, ...props }));

const inputTag = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0];

test('credential inputs stay disabled until consent is accepted', () => {
  const html = render();
  assert.match(inputTag(html, 'username'), /disabled=""/);
  assert.match(inputTag(html, 'password'), /disabled=""/);
  assert.match(html, /권한이 높은 계정일수록/);
  assert.doesNotMatch(html, /거부|읽기 전용 계정만/);
});

test('after consent inputs are enabled and the stored value is never echoed', () => {
  const fresh = render({ consentAccepted: true });
  assert.doesNotMatch(inputTag(fresh, 'username'), /disabled/);
  assert.doesNotMatch(inputTag(fresh, 'password'), /disabled|value=/);
  assert.match(fresh, /암호화 저장/);
  const html = render({ consentAccepted: true, stored: { usernameHint: 'ab***', expiresAt: '2026-11-09T03:00:00.000Z' } });
  assert.match(html, /저장됨 \(ab\*\*\*\), 만료 2026-11-09 12:00 KST/);
  assert.match(html, /계정 교체/);
  // I-051: credential inputs stay closed until 계정 교체 is clicked.
  assert.doesNotMatch(html, /name="username"|name="password"/);
});

test('disabled feature flag keeps everything locked and shows a notice', () => {
  const html = render({ enabled: false, consentAccepted: true });
  assert.match(html, /준비 중인 기능/);
  assert.match(inputTag(html, 'password'), /disabled=""/);
});

test('formatKst converts UTC to KST', () => {
  assert.equal(formatKst('2026-10-26T15:30:00.000Z'), '2026-10-27 00:30 KST');
});

test('observation form appears only once a credential is stored', () => {
  assert.doesNotMatch(render({ consentAccepted: true }), /name="loginUrl"|>관찰 실행<\/button>/);
  const html = render({ consentAccepted: true, stored: { usernameHint: 'ab***', expiresAt: '2026-11-09T03:00:00.000Z' } });
  assert.match(html, />관찰 실행<\/button>/);
  assert.match(html, /name="loginUrl"/);
});

test('resultText maps reasons to Korean and never echoes values', () => {
  assert.equal(resultText(null, 'ok'), null);
  assert.match(resultText({ ok: false, reason: 'KEY_NOT_CONFIGURED' }, 'ok')!, /암호화 키/);
  assert.match(resultText({ ok: true, summary: { ok: true, stop: null, pagesObserved: 2, blockedRequestCount: 1 } }, 'ok')!, /관찰 페이지 2개, 차단된 요청 1건/);
});

const storedProps = { consentAccepted: true, stored: { usernameHint: 'ab***', expiresAt: '2026-11-09T03:00:00.000Z' } };
const count = (html: string, re: RegExp) => (html.match(new RegExp(re.source, 'g')) ?? []).length;

test('I-051: scope fields appear once and every step submits through one form', () => {
  const html = render(storedProps);
  assert.equal(count(html, /name="allowedOrigins"/), 1);
  assert.equal(count(html, /name="authOrigins"/), 1);
  assert.equal(count(html, /name="paths"/), 1);
  assert.equal(count(html, /<form/), 1);
  const before = render();
  assert.equal(count(before, /name="allowedOrigins"/), 1);
  assert.match(before, />동의 저장<\/button>/);
});

test('I-051: consent step shows a done state instead of the checkbox after saving', () => {
  const html = render(storedProps);
  assert.match(html, /동의 완료 ✓/);
  assert.doesNotMatch(html, /name="consent"/);
  assert.match(render(), /name="consent"/);
});

test('I-051: every field has a label with a 필수/선택 badge, helper line and example', () => {
  const html = render({ ...storedProps, classes: { required: 'req', optional: 'opt' } });
  const badge = (label: string) => html.match(new RegExp(`${label}<span class="(req|opt)">(필수|선택)</span>`))?.[2];
  assert.equal(badge('허용 도메인'), '필수');
  assert.equal(badge('인증 서버 도메인'), '선택');
  assert.equal(badge('관찰 경로 \\(선택\\)'), '선택');
  assert.equal(badge('로그인 주소'), '필수');
  assert.equal(badge('아이디 입력란 선택자'), '필수');
  assert.equal(badge('비밀번호 입력란 선택자'), '필수');
  assert.equal(badge('로그인 버튼 선택자'), '필수');
  assert.equal(badge('로그인 성공 경로'), '선택');
  assert.match(html, /placeholder="https:\/\/app.example.com"/);
  assert.match(html, /aria-describedby="[^"]+-help"/);
  const fresh = render({ consentAccepted: true, classes: { required: 'req', optional: 'opt' } });
  assert.match(fresh, /아이디<span class="req">필수<\/span>/);
  assert.match(fresh, /비밀번호<span class="req">필수<\/span>/);
});

test('I-051: login settings are collapsed with selector defaults and long notices sit under 자세히', () => {
  const html = render(storedProps);
  assert.match(html, /<details><summary>로그인 설정 \(고급\)<\/summary>/);
  assert.match(inputTag(html, 'usernameSelector'), /value="#email"/);
  assert.match(inputTag(html, 'passwordSelector'), /value="#password"/);
  assert.match(inputTag(html, 'submitSelector'), /value="button\[type=submit\]"/);
  assert.match(html, /<summary>관찰 방식 자세히<\/summary>/);
  assert.match(html, /<summary>보관 기간 자세히<\/summary>/);
});

test('I-051: login failures open the advanced login settings', () => {
  assert.equal(isLoginFailure(null), false);
  assert.equal(isLoginFailure({ ok: false, reason: 'LOGIN_NOT_SUBMITTED' }), true);
  assert.equal(isLoginFailure({ ok: false, reason: 'LOGIN_PLAN_INVALID' }), true);
  assert.equal(isLoginFailure({ ok: false, reason: 'SCOPE_INVALID' }), false);
  assert.equal(isLoginFailure({ ok: true, summary: { ok: false, stop: 'LOGIN_NO_REDIRECT', pagesObserved: 0, blockedRequestCount: 0 } }), true);
  assert.equal(isLoginFailure({ ok: true, summary: { ok: true, stop: null, pagesObserved: 3, blockedRequestCount: 0 } }), false);
});
