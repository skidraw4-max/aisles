import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { containsRawCredential, providerError } from '../provider-types';
import { githubPayloadHasSecret, githubProseContainsSecret } from './document-secret';

const TOKEN = 'FAKE_GITHUB_TOKEN_80_18';
const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----';
const CLIENT_SECRET = 'FAKE_GITHUB_SECRET_80_18';
const SHAPED = 'ghp_fakeprefix0123456789abcdef';

const NORMAL = [
  'Use a token to authenticate the request.',
  'The access token expires after one hour.',
  'Configure your GitHub token in the local development environment.',
  'The API accepts a bearer token.',
  'Set the TOKEN environment variable before running the example.',
  'Choose a strong password and store the key in a password manager.',
];

test('github prose allows technical documentation that only mentions credentials', () => {
  assert.equal(containsRawCredential(NORMAL[0]), true);
  for (const sentence of NORMAL) {
    assert.equal(githubProseContainsSecret(sentence), false);
    assert.equal(githubPayloadHasSecret({ section: sentence, hints: [sentence] }), false);
  }
});

test('github prose still blocks synthetic secrets and keeps them out of errors', () => {
  const samples = [
    PRIVATE_KEY,
    SHAPED,
    TOKEN,
    `CLIENT_SECRET=${CLIENT_SECRET}`,
    `TOKEN=${TOKEN}`,
    `Authorization: Bearer ${TOKEN}`,
    `{"access_token":"${SHAPED}"}`,
  ];
  for (const sample of samples) assert.equal(githubProseContainsSecret(sample), true);
  const rejected = providerError('SECRET_REJECTED');
  const serialized = JSON.stringify({ message: rejected.message, code: rejected.code, payload: { section: null } });
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes(CLIENT_SECRET), false);
  assert.equal(serialized.includes(SHAPED), false);
  assert.equal(serialized.includes('BEGIN PRIVATE'), false);
  assert.equal(githubPayloadHasSecret({ evidence: { section: TOKEN }, pack: { hints: [NORMAL[0]] } }), true);
});

test('github evidence screening uses the prose check and leaves the global credential check intact', () => {
  const product = readFileSync(new URL('./product.ts', import.meta.url), 'utf8');
  const collector = readFileSync(new URL('./collector.ts', import.meta.url), 'utf8');
  assert.equal(product.includes('containsRawCredential(draft.evidence)'), false);
  assert.equal(product.includes('containsRawCredential(pack)'), false);
  assert.equal(product.includes('githubPayloadHasSecret'), true);
  assert.equal(collector.includes('githubProseContainsSecret'), true);
  assert.equal(product.includes(TOKEN), false);
});
