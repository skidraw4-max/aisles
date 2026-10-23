'use client';

/** RM-21 (I-026): review type + claim inputs on the evidence card. Server re-validates (runTenantReview). */
import { useEffect, useRef, useState } from 'react';
import { JURY_CLAIM_MAX_LENGTH } from '@/lib/jury-product/records';
import styles from './jury.module.css';

export function ReviewRequestFields() {
  const [reviewType, setReviewType] = useState<'FULL_REVIEW' | 'CLAIM_VALIDATION'>('FULL_REVIEW');
  const [claim, setClaim] = useState('');
  const claimRef = useRef<HTMLTextAreaElement>(null);
  const claimRequired = reviewType === 'CLAIM_VALIDATION';
  // Client guard: CLAIM_VALIDATION with an empty/whitespace-only claim cannot be submitted.
  useEffect(() => {
    claimRef.current?.setCustomValidity(claimRequired && claim.trim().length === 0 ? '검증할 주장을 입력하세요.' : '');
  }, [claimRequired, claim]);
  return (
    <>
      <label>
        리뷰 유형
        <select
          className={styles.field}
          name="reviewType"
          value={reviewType}
          onChange={(event) => setReviewType(event.target.value === 'CLAIM_VALIDATION' ? 'CLAIM_VALIDATION' : 'FULL_REVIEW')}
        >
          <option value="FULL_REVIEW">전체 리뷰</option>
          <option value="CLAIM_VALIDATION">주장 검증</option>
        </select>
      </label>
      <label>
        {claimRequired ? '검증할 주장 (필수)' : '검증할 주장 (선택)'}
        <textarea
          className={styles.field}
          name="claim"
          ref={claimRef}
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
          maxLength={JURY_CLAIM_MAX_LENGTH}
          required={claimRequired}
          rows={2}
        />
      </label>
      <p className={styles.muted}>주장 검증은 주장이 있어야 요청됩니다 · 최대 {JURY_CLAIM_MAX_LENGTH}자 · 앞뒤 공백은 제거됩니다</p>
    </>
  );
}
