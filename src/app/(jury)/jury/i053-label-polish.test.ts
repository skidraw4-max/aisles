import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataSourceLabels, displayText, metricLabel, scopeResourceLabel, surfaceLabels } from '@/lib/jury-product/ui-labels';

test('I-053: evidence collectionStatus Collected matches 자료 AVAILABLE label', () => {
  assert.equal(displayText('Collected'), displayText('AVAILABLE'));
  assert.equal(displayText('Collected'), '사용 가능');
});

test('I-053: metric keys get Korean display names', () => {
  assert.equal(metricLabel('userCount'), '전체 사용자 수');
  assert.equal(metricLabel('newUsersLast7d'), '최근 7일 신규 사용자 수');
  assert.equal(metricLabel('ga4.newUsers'), 'GA4 신규 사용자 수');
  assert.equal(metricLabel('ga4.eventCount.sign_up'), 'GA4 이벤트 수 (sign_up)');
  assert.equal(metricLabel('readonly.pagesObserved'), '관찰 페이지 수');
});

test('I-053: surfaces, data sources and scope resources in Korean', () => {
  assert.equal(surfaceLabels(['FRONTEND', 'ADMIN', 'BO', 'API']), '사용자 화면, 관리자 화면, 백오피스, API');
  assert.equal(dataSourceLabels(['API', 'SCREEN', 'FILE', 'STATS']), 'API, 화면, 파일, 통계');
  assert.equal(scopeResourceLabel('metric:https://sidesync.io/.routes'), '화면 경로 후보');
  assert.equal(scopeResourceLabel('metric:https://sidesync.io/.api'), 'API 자원 후보');
  assert.equal(scopeResourceLabel('/https://sidesync.io'), 'https://sidesync.io');
});
