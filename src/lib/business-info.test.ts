/**
 * Node built-in test — no vitest/jest in this repo.
 * Run: node --import tsx --test src/lib/business-info.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUSINESS_INFO,
  getBusinessRegistrationNumberDigits,
  getFtcBizCommPopUrl,
} from './business-info';

describe('business-info', () => {
  it('strips dashes for FTC wrkr_no', () => {
    assert.equal(getBusinessRegistrationNumberDigits(), '2385201108');
  });

  it('builds FTC bizCommPop URL with digits-only wrkr_no', () => {
    assert.equal(
      getFtcBizCommPopUrl(),
      'https://www.ftc.go.kr/bizCommPop.do?wrkr_no=2385201108',
    );
  });

  it('exposes filled mail-order registration number from certificate', () => {
    assert.equal(BUSINESS_INFO.mailOrderRegistrationNumber, '제2026-충남공주-0146호');
  });
});
