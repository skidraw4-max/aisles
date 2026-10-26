import assert from 'node:assert/strict';
import { test } from 'node:test';
import { READONLY_ACCOUNT_PHASE1_ENABLED, READONLY_ACCOUNT_UI_ENABLED, shouldShowReadonlyAccountSection } from '@/lib/jury-product/services/readonly-account/flags';

test('flags stay off', () => {
  assert.equal(READONLY_ACCOUNT_UI_ENABLED, false);
  assert.equal(READONLY_ACCOUNT_PHASE1_ENABLED, false);
});

test('section only for READ_ONLY_ACCOUNT connections with the UI flag on', () => {
  assert.equal(shouldShowReadonlyAccountSection({ uiEnabled: false, accessMethod: 'READ_ONLY_ACCOUNT' }), false);
  assert.equal(shouldShowReadonlyAccountSection({ uiEnabled: true, accessMethod: 'API_TOKEN' }), false);
  assert.equal(shouldShowReadonlyAccountSection({ uiEnabled: true, accessMethod: 'READ_ONLY_ACCOUNT' }), true);
});
