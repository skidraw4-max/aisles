import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatKst, ReadOnlyAccountCredentialForm, resultText } from './ReadOnlyAccountCredentialForm';

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
  const html = render({ consentAccepted: true, stored: { usernameHint: 'ab***', expiresAt: '2026-11-09T03:00:00.000Z' } });
  assert.doesNotMatch(inputTag(html, 'username'), /disabled/);
  assert.doesNotMatch(inputTag(html, 'password'), /disabled|value=/);
  assert.match(html, /저장됨 \(ab\*\*\*\), 만료 2026-11-09 12:00 KST/);
  assert.match(html, /교체 저장/);
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
  assert.doesNotMatch(render({ consentAccepted: true }), /관찰 실행/);
  const html = render({ consentAccepted: true, stored: { usernameHint: 'ab***', expiresAt: '2026-11-09T03:00:00.000Z' } });
  assert.match(html, /관찰 실행/);
  assert.match(html, /name="loginUrl"/);
});

test('resultText maps reasons to Korean and never echoes values', () => {
  assert.equal(resultText(null, 'ok'), null);
  assert.match(resultText({ ok: false, reason: 'KEY_NOT_CONFIGURED' }, 'ok')!, /암호화 키/);
  assert.match(resultText({ ok: true, summary: { ok: true, stop: null, pagesObserved: 2, blockedRequestCount: 1 } }, 'ok')!, /관찰 페이지 2개, 차단된 요청 1건/);
});
