/**
 * Run: node --import tsx --test src/lib/jury-product/improvement-trace-guard-mapping.test.ts
 * DB-free. Imports only service-feature-authorization (pure).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { externalFeatureDenial } from './service-feature-authorization';

test('missing grant, missing resource and other tenant map to NOT_FOUND', () => {
  assert.equal(externalFeatureDenial({ reason: 'FORBIDDEN', denial: 'SERVICE_NOT_GRANTED' }), 'NOT_FOUND');
  assert.equal(externalFeatureDenial({ reason: 'NOT_FOUND' }), 'NOT_FOUND');
  assert.equal(externalFeatureDenial({ reason: 'TENANT_MISMATCH' }), 'NOT_FOUND');
});

test('a role shortfall stays FORBIDDEN', () => {
  assert.equal(externalFeatureDenial({ reason: 'FORBIDDEN', denial: 'ROLE' }), 'FORBIDDEN');
  assert.equal(externalFeatureDenial({ reason: 'FORBIDDEN' }), 'FORBIDDEN');
});

test('authentication and membership failures are left to the caller', () => {
  for (const reason of ['UNAUTHENTICATED', 'NO_MEMBERSHIP', 'STORE_UNAVAILABLE']) {
    assert.equal(externalFeatureDenial({ reason }), null, reason);
  }
});

test('the external value never carries the denial', () => {
  for (const denial of ['ROLE', 'SERVICE_NOT_GRANTED']) {
    const value = externalFeatureDenial({ reason: 'FORBIDDEN', denial });
    assert.equal(value === 'FORBIDDEN' || value === 'NOT_FOUND', true, denial);
    assert.equal(String(value).includes(denial), false, denial);
  }
});
