import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONNECTED_EVIDENCE_REVIEW_NOTICE, evidenceReviewPath } from './evidence-review-path';
import { TENANT_INTAKE_PURPOSE } from './tenant-evidence-intake';

test('I-029: declared intake evidence keeps the evidence-card review form', () => {
  assert.equal(evidenceReviewPath({ purpose: TENANT_INTAKE_PURPOSE }), 'TENANT_INTAKE');
});

test('I-029: connected-collection evidence uses the service-page path (no claim input)', () => {
  assert.equal(evidenceReviewPath({ purpose: 'observe' }), 'CONNECTED_SERVICE');
  assert.equal(evidenceReviewPath({ purpose: '가입 수 확인' }), 'CONNECTED_SERVICE');
  assert.equal(evidenceReviewPath({ purpose: '' }), 'CONNECTED_SERVICE');
  assert.match(CONNECTED_EVIDENCE_REVIEW_NOTICE, /서비스 화면/);
});
