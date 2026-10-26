import assert from 'node:assert/strict';
import { test } from 'node:test';
import { READONLY_ACCOUNT_PHASE1_ENABLED, READONLY_ACCOUNT_UI_ENABLED, shouldShowReadonlyAccountSection } from '@/lib/jury-product/services/readonly-account/flags';

test('flags are enabled (I-044)', () => {
  assert.equal(READONLY_ACCOUNT_UI_ENABLED, true);
  assert.equal(READONLY_ACCOUNT_PHASE1_ENABLED, true);
});

test('section only for READ_ONLY_ACCOUNT connections with the UI flag on', () => {
  assert.equal(shouldShowReadonlyAccountSection({ uiEnabled: false, accessMethod: 'READ_ONLY_ACCOUNT' }), false);
  assert.equal(shouldShowReadonlyAccountSection({ uiEnabled: true, accessMethod: 'API_TOKEN' }), false);
  assert.equal(shouldShowReadonlyAccountSection({ uiEnabled: true, accessMethod: 'READ_ONLY_ACCOUNT' }), true);
});
