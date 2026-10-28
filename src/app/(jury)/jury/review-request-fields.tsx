'use client';

/** RM-21 (I-026): review type + claim inputs on the evidence card. Server re-validates (runTenantReview). */
import { useEffect, useId, useRef, useState } from 'react';
import { JURY_CLAIM_MAX_LENGTH } from '@/lib/jury-product/records';
import { claimLengthState } from '@/lib/jury-product/claim-length';
import styles from './jury.module.css';

export function ReviewRequestFields() {
  const [reviewType, setReviewType] = useState<'FULL_REVIEW' | 'CLAIM_VALIDATION'>('FULL_REVIEW');
  const [claim, setClaim] = useState('');
  const claimRef = useRef<HTMLTextAreaElement>(null);
  const counterId = useId();
  const claimRequired = reviewType === 'CLAIM_VALIDATION';
  // I-031: counted like the server (trimmed, UTF-16 units, line break submitted as CRLF = 2).
  const length = claimLengthState(claim);
  // Client guard: CLAIM_VALIDATION with an empty/whitespace-only claim cannot be submitted.
  useEffect(() => {
    claimRef.current?.setCustomValidity(
      claimRequired && length.blank
        ? '검증할 주장을 입력하세요.'
        : length.tooLong
          ? `주장은 ${JURY_CLAIM_MAX_LENGTH}자 이하로 입력하세요. 줄바꿈은 2자로 세요.`
          : '',
    );
  }, [claimRequired, length.blank, length.tooLong]);
  return (
    <>
      <label>
        심사 유형
        <select
          className={styles.field}
          name="reviewType"
          value={reviewType}
          onChange={(event) => setReviewType(event.target.value === 'CLAIM_VALIDATION' ? 'CLAIM_VALIDATION' : 'FULL_REVIEW')}
        >
          <option value="FULL_REVIEW">전체 심사</option>
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
          aria-describedby={counterId}
        />
      </label>
      <p id={counterId} className={styles.muted} aria-live="polite">
        {length.length}/{length.max}자{length.tooLong ? ' · 최대 글자 수를 넘었어요' : ''}
      </p>
      <p className={styles.muted}>주장 검증은 주장이 있어야 요청돼요 · 최대 {JURY_CLAIM_MAX_LENGTH}자 · 앞뒤 공백은 제거돼요</p>
    </>
  );
}
