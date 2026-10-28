'use client';
import * as React from 'react';
import type { saveSiteContextAction } from './site-context-actions';
import { Button } from './jury-controls';
import styles from './jury.module.css';
import { SITE_TYPES, type SiteContext } from '@/lib/jury-product/site-context-types';

export const SITE_CONTEXT_REASON_TEXT: Record<string, string> = {
  INVALID_SITE_TYPE: '사이트 유형을 골라 주세요.',
  INVALID_URL: '참고 사이트 주소는 http(s)로 시작하는 주소만 쓸 수 있어요.',
  SECRET_LIKE: '비밀번호·토큰처럼 보이는 내용은 저장할 수 없어요.',
  FORBIDDEN: '현재 역할에는 이 변경 권한이 없어요.',
  TENANT_MISMATCH: '현재 역할에는 이 변경 권한이 없어요.',
  UNAUTHENTICATED: '다시 로그인해 주세요.',
  NOT_FOUND: '서비스를 찾을 수 없어요.',
  CONNECTION_DELETED: '삭제된 서비스라 바꿀 수 없어요.',
};

export function SiteContextForm(props: { connectionId: string; current: SiteContext | null; action: typeof saveSiteContextAction }) {
  const [result, formAction, pending] = React.useActionState(props.action, null);
  const c = props.current;
  return (
    <form action={formAction} className={styles.connectForm}>
      <input type="hidden" name="connectionId" value={props.connectionId} />
      <label>
        사이트 유형
        <select className={styles.field} name="siteType" defaultValue={c?.siteType ?? ''} required>
          <option value="" disabled>선택</option>
          {SITE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label>주요 사용자 <input className={styles.field} name="primaryUsers" maxLength={200} defaultValue={c?.primaryUsers ?? ''} placeholder="예: 30~50대 회원, 재구매 고객" /></label>
      <label>핵심 작업 (한 줄에 하나, 최대 3개)<textarea className={styles.field} name="coreTasks" rows={3} defaultValue={c?.coreTasks.join('\n') ?? ''} placeholder={'예: 제품 찾기\n장바구니 담기'} /></label>
      <label>유지할 브랜드 특성 <input className={styles.field} name="brandTraits" maxLength={200} defaultValue={c?.brandTraits ?? ''} placeholder="예: 신뢰감 있는 녹색 톤, 큰 제품 사진" /></label>
      <label>참고 사이트 주소 (선택) <input className={styles.field} name="referenceUrl" type="url" maxLength={300} defaultValue={c?.referenceUrl ?? ''} /></label>
      <p className={styles.muted}>참고 사이트는 저장만 해요. 아직 심사에 쓰거나 비교하지 않아요.</p>
      <Button type="submit" variant="primary" disabled={pending}>{pending ? '저장 중…' : '사이트 정보 저장'}</Button>
      {result ? <p role="status">{result.ok ? '저장했어요. 다음 심사부터 반영돼요.' : SITE_CONTEXT_REASON_TEXT[result.reason] ?? `저장하지 못했어요 (${result.reason}).`}</p> : null}
    </form>
  );
}
