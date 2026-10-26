import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CONNECTED_REVIEW_PENDING_NOTE,
  CREDENTIAL_RETENTION_DAYS,
  CREDENTIAL_RETENTION_NOTE,
  NOT_MEASURED_TEXT,
  READONLY_CONNECTION_NOTICE,
  READONLY_PROVIDER_LABEL,
  connectedMetricText,
  connectedReviewStatusText,
} from './connected-service-copy';
import { DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS } from './services/readonly-account/consent';
import { AUDIT_ACTION_LABELS } from './ui-labels';

test('I-048: credential retention note uses the real retention period (consent.ts)', () => {
  assert.equal(CREDENTIAL_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
  assert.equal(CREDENTIAL_RETENTION_DAYS, MAX_RETENTION_DAYS);
  assert.equal(CREDENTIAL_RETENTION_NOTE, '저장된 계정은 14일 뒤 자동 파기돼요. 계속 쓰려면 교체 저장으로 갱신하세요.');
});

test('I-048: copy module stays client-safe (no imports)', () => {
  assert.doesNotMatch(readFileSync('src/lib/jury-product/connected-service-copy.ts', 'utf8'), /^import /m);
});

test('I-048: unmeasured metrics read 측정 안 됨; real values keep the shared formatter', () => {
  const fmt = (v: number | null, a: string) => `${a}:${v}`;
  assert.equal(connectedMetricText(null, 'NOT_MEASURED', fmt), NOT_MEASURED_TEXT);
  assert.equal(connectedMetricText(null, 'NOT_AVAILABLE', fmt), '측정 안 됨');
  assert.equal(connectedMetricText(3, 'AVAILABLE', fmt), 'AVAILABLE:3');
});

test('I-048: review status word is consistent (진행 중 / 중단됨 / 심사 없음)', () => {
  const label = (v: string) => `L:${v}`;
  assert.equal(connectedReviewStatusText(null, false, label), '심사 없음');
  assert.equal(connectedReviewStatusText('RUNNING', false, label), '진행 중');
  assert.equal(connectedReviewStatusText('RUNNING', true, label), '중단됨');
  assert.equal(connectedReviewStatusText('FAILED', false, label), 'L:FAILED');
  assert.match(CONNECTED_REVIEW_PENDING_NOTE, /최대 5분/);
});

test('I-048: readonly activity entries have Korean labels', () => {
  for (const key of ['READONLY_ACCOUNT_OBSERVATION_RUN', 'READONLY_ACCOUNT_CREDENTIAL_DESTROYED', 'READONLY_ACCOUNT_CREDENTIAL_EXPIRED_DESTROYED', 'READONLY_ACCOUNT_CONSENT_ACCEPTED']) {
    assert.match(AUDIT_ACTION_LABELS[key] ?? '', /[가-힣]/, key);
  }
  const src = readFileSync('src/lib/jury-product/service-operations-status.ts', 'utf8');
  assert.match(src, /known\[action\] \?\? AUDIT_ACTION_LABELS\[action\] \?\?/);
});

test('I-048: READ_ONLY_ACCOUNT hides the mock provider name and the "외부 인증은 실행하지 않습니다" notice', () => {
  assert.doesNotMatch(READONLY_CONNECTION_NOTICE, /외부 인증은 실행하지 않습니다/);
  assert.notEqual(READONLY_PROVIDER_LABEL, 'Mock service');
  assert.match(readFileSync('src/lib/jury-product/services/connection-configuration.ts', 'utf8'), /connectionMethod === 'READ_ONLY_ACCOUNT'\s*\?\s*READONLY_CONNECTION_NOTICE/);
  assert.match(readFileSync('src/lib/jury-product/services/provider-boundary.ts', 'utf8'), /accessMethod === 'READ_ONLY_ACCOUNT' && definition\.definition\.provider === 'MOCK'/);
});

test('I-048: service detail UI uses Korean review/collect buttons and no English Not available for metrics', () => {
  const ui = readFileSync('src/app/(jury)/jury/service-onboarding-ui.tsx', 'utf8');
  assert.match(ui, /label="자료 수집"/);
  assert.match(ui, /label="심사 실행" pendingLabel="심사 진행 중"/);
  assert.doesNotMatch(ui, /"Run Review"|"Collect Evidence"/);
  const ops = readFileSync('src/app/(jury)/jury/service-operations-ui.tsx', 'utf8');
  assert.match(ops, /model\.review\.running \? <p>진행 중<\/p> : <p>심사 없음<\/p>/);
  assert.doesNotMatch(ops, /displayText\('Not available'\)/);
});
