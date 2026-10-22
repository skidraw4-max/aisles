/**
 * Run: node --import tsx --test src/lib/kakao-adfit.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getKakaoAdfitGameBannerUnitId,
  getKakaoAdfitGameStripUnitId,
  KAKAO_GAME_BANNER_HEIGHT,
  KAKAO_GAME_BANNER_WIDTH,
  KAKAO_GAME_STRIP_HEIGHT,
  KAKAO_GAME_STRIP_WIDTH,
} from './kakao-adfit';

describe('kakao-adfit game units', () => {
  it('defaults game strip to 320×50 unit DAN-cH8wBucZnkY8FAwq', () => {
    assert.equal(KAKAO_GAME_STRIP_WIDTH, 320);
    assert.equal(KAKAO_GAME_STRIP_HEIGHT, 50);
    assert.equal(getKakaoAdfitGameStripUnitId(), 'DAN-cH8wBucZnkY8FAwq');
  });

  it('defaults game banner to 320×100 unit DAN-M1mJWELRJTphSTeL', () => {
    assert.equal(KAKAO_GAME_BANNER_WIDTH, 320);
    assert.equal(KAKAO_GAME_BANNER_HEIGHT, 100);
    assert.equal(getKakaoAdfitGameBannerUnitId(), 'DAN-M1mJWELRJTphSTeL');
  });

  it('allows override unit ids', () => {
    assert.equal(getKakaoAdfitGameStripUnitId('DAN-override-strip'), 'DAN-override-strip');
    assert.equal(getKakaoAdfitGameBannerUnitId('DAN-override-banner'), 'DAN-override-banner');
  });
});
