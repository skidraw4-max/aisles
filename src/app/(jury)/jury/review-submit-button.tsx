'use client';

/**
 * I-030 / I-034: submit button for the evidence-card review form.
 * - submitting: disabled + elapsed time until the page navigates (success → result page; refusal →
 *   same route with ?result=) or the action resolves without navigation. Progress is owned here
 *   (review-submit-progress), not read from useFormStatus: in React 19.2 the elapsed-time state
 *   update dropped `pending` after ~8ms (I-034).
 * - duplicate submits are refused in the form's submit handler (ref guard + preventDefault), not
 *   only via `disabled`.
 * - over the function limit: says the browser stopped waiting; the real state comes from the server.
 * - action returned but no navigation happened: offers a refresh to read the stored state.
 * Never shows success or failure itself. Server action, its signature and the form are unchanged.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IDLE_PROGRESS,
  canSubmit,
  elapsedSeconds,
  nextReviewSubmitProgress,
  type ReviewSubmitEvent,
  type ReviewSubmitProgress,
} from '@/lib/jury-product/review-submit-progress';
import styles from './jury.module.css';

/** Matches `maxDuration` in the (jury) layout. */
export const REVIEW_ACTION_LIMIT_SECONDS = 300;

export function ReviewSubmitButton({ label, disabledReason }: { label: string; disabledReason?: string | null }) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const progressRef = useRef<ReviewSubmitProgress>(IDLE_PROGRESS);
  const [progress, setProgress] = useState<ReviewSubmitProgress>(IDLE_PROGRESS);
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  const dispatch = useCallback((event: ReviewSubmitEvent) => {
    const next = nextReviewSubmitProgress(progressRef.current, event);
    if (next === progressRef.current) return;
    progressRef.current = next;
    setProgress(next);
  }, []);

  const blocked = Boolean(disabledReason);

  // Native listeners on the form: run before React's form-action handling (delegated at the root),
  // so a refused submit is preventDefault-ed and stopped before a second action can start.
  useEffect(() => {
    const form = buttonRef.current?.form;
    if (!form) return;
    const onSubmit = (event: SubmitEvent) => {
      if (blocked || !canSubmit(progressRef.current)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      dispatch({ type: 'SUBMIT', now: Date.now(), href: window.location.href });
    };
    // React resets the form once the action function has resolved (not on redirect/throw).
    const onReset = () => dispatch({ type: 'RESOLVED', now: Date.now() });
    form.addEventListener('submit', onSubmit);
    form.addEventListener('reset', onReset);
    return () => {
      form.removeEventListener('submit', onSubmit);
      form.removeEventListener('reset', onReset);
    };
  }, [blocked, dispatch]);

  const submitting = progress.phase === 'SUBMITTING';
  useEffect(() => {
    if (!submitting) return;
    const tick = () => {
      dispatch({ type: 'TICK', now: Date.now(), href: window.location.href, limitSeconds: REVIEW_ACTION_LIMIT_SECONDS });
      forceTick();
    };
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [submitting, dispatch]);

  const elapsed = elapsedSeconds(progress, Date.now());
  const overLimit = submitting && elapsed > REVIEW_ACTION_LIMIT_SECONDS;
  // Only IDLE accepts a submit (canSubmit), so every other phase also shows the button disabled.
  const busy = progress.phase !== 'IDLE';
  return (
    <>
      <button ref={buttonRef} className={styles.primaryButton} type="submit" disabled={busy || blocked} aria-busy={submitting || undefined}>
        {submitting ? `리뷰 진행 중… ${elapsed}초` : label}
      </button>
      {blocked && !busy ? <p className={styles.muted}>{disabledReason}</p> : null}
      {submitting ? (
        <p className={styles.muted} role="status" aria-live="polite">
          {overLimit
            ? `서버 실행 한도(${REVIEW_ACTION_LIMIT_SECONDS}초)를 넘었습니다. 완료·실패 여부는 새로고침 후 이 카드의 상태나 리뷰 목록에서 확인하세요. 다시 요청하지 마세요.`
            : 'AI 심사를 실행하고 있습니다. 보통 2~3분 걸립니다. 버튼을 다시 누르지 마세요. 완료되면 결과 화면으로 이동합니다.'}
        </p>
      ) : null}
      {progress.phase === 'TIMED_OUT' ? (
        <p className={styles.muted} role="status" aria-live="polite">
          브라우저가 응답 대기를 멈췄습니다. 완료·실패 여부는 새로고침 후 이 카드의 상태나 리뷰 목록에서 확인하세요. 다시 요청하지 마세요.{' '}
          <button className={styles.button} type="button" onClick={() => { dispatch({ type: 'RESET' }); router.refresh(); }}>상태 새로고침</button>
        </p>
      ) : null}
      {progress.phase === 'NO_NAVIGATION' ? (
        <p className={styles.muted} role="status" aria-live="polite">
          응답을 받았지만 화면이 이동하지 않았습니다. 실제 상태를 다시 읽어 오세요.{' '}
          <button className={styles.button} type="button" onClick={() => { dispatch({ type: 'RESET' }); router.refresh(); }}>상태 새로고침</button>
        </p>
      ) : null}
    </>
  );
}
