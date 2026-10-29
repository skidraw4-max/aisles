import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JURY_OG_IMAGE_PATH,
  juryHostOpenGraphMetadata,
  requestHostname,
} from './jury-open-graph';

test('requestHostname prefers x-forwarded-host', () => {
  assert.equal(requestHostname('internal', 'jury.aisleshub.com, proxy'), 'jury.aisleshub.com');
  assert.equal(requestHostname('Jury.AislesHub.com:443', null), 'jury.aisleshub.com');
});

test('jury host open graph points at the jury og asset', () => {
  const meta = juryHostOpenGraphMetadata('jury.aisleshub.com');
  assert.ok(meta);
  assert.equal(String(meta.metadataBase), 'https://jury.aisleshub.com/');
  const og = meta.openGraph;
  assert.ok(og && !Array.isArray(og));
  assert.equal(og.siteName, 'AIsles Jury');
  assert.equal(og.images?.[0]?.url, JURY_OG_IMAGE_PATH);
  assert.equal(meta.twitter?.images?.[0]?.url, JURY_OG_IMAGE_PATH);
});

test('hub host leaves jury og metadata unset', () => {
  assert.equal(juryHostOpenGraphMetadata('www.aisleshub.com'), null);
  assert.equal(juryHostOpenGraphMetadata('aisleshub.com'), null);
});
