import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildKakaoShareUrl, buildXShareUrl } from './share-social';

describe('share-social', () => {
  it('builds X intent URL', () => {
    const href = buildXShareUrl('https://www.aisleshub.com/post/1', 'Hello');
    assert.match(href, /^https:\/\/twitter\.com\/intent\/tweet\?/);
    assert.match(href, /url=/);
    assert.match(href, /text=/);
  });

  it('builds Kakao story share URL', () => {
    const href = buildKakaoShareUrl('https://www.aisleshub.com/post/1');
    assert.match(href, /^https:\/\/story\.kakao\.com\/share\?/);
  });
});
