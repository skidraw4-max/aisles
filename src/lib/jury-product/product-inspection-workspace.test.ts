/**
 * Product lineage maps to the mock inspection workspace without naming files.
 * Run: node --import tsx --test src/lib/jury-product/product-inspection-workspace.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inspectionWorkspaceForProduct } from './product-inspection-workspace';

test('product lineage maps only jury-product to the mock inspection workspace', () => {
  assert.deepEqual(inspectionWorkspaceForProduct({ type: 'PROJECT', ref: 'jury-product' }), {
    type: 'PROJECT',
    ref: 'mock-aisle',
  });
  assert.equal(inspectionWorkspaceForProduct({ type: 'PROJECT', ref: 'mock-aisle' }), null);
  assert.equal(inspectionWorkspaceForProduct({ type: 'PROJECT', ref: 're-review-fixture' }), null);
  assert.equal(inspectionWorkspaceForProduct({ type: 'PROJECT', ref: 'elsewhere' }), null);
  const source = readFileSync(new URL('./product-inspection-workspace.ts', import.meta.url), 'utf8');
  for (const token of ['user-facing-copy', 'data/', 'resolveAllowedWorkspace', 'inspectAllowlistedWorkspace', 'readFile', 'readdir']) {
    assert.equal(source.includes(token), false, token);
  }
});
