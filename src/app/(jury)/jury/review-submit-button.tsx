'use client';

/**
 * I-030: submit button for the evidence-card review form.
 * - pending (server action in flight): disabled + elapsed time, so a second paid run is not started.
 * - over the function limit: says the browser stopped waiting; the real state comes from the server
 *   (refresh → per-card status from stored attempts/results). Never shows success or failure itself.
 * - action returned but no navigation happened: offers a refresh to read the stored state.
 */
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import styles from './jury.module.css';

/** Matches `maxDuration` in the (jury) layout. */
export const REVIEW_ACTION_LIMIT_SECONDS = 300;

export function ReviewSubmitButton({ label, disabledReason }: { label: string; disabledReason?: string | null }) {
  const { pending } = useFormStatus();
  const router = useRouter();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [settledWithoutNavigation, setSettledWithoutNavigation] = useState(false);
  const wasPending = useRef(false);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      setSettledWithoutNavigation(false);
      setStartedAt((value) => value ?? Date.now());
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    setStartedAt(null);
    // redirect() normally unmounts this card; still mounted a moment later = no navigation.
    const timer = window.setTimeout(() => setSettledWithoutNavigation(true), 3000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const blocked = Boolean(disabledReason);
  const overLimit = pending && elapsed > REVIEW_ACTION_LIMIT_SECONDS;
  return (
    <>
      <button className={styles.primaryButton} type="submit" disabled={pending || blocked} aria-busy={pending || undefined}>
        {pending ? `리뷰 진행 중… ${elapsed}초` : label}
      </button>
      {blocked && !pending ? <p className={styles.muted}>{disabledReason}</p> : null}
      {pending ? (
        <p className={styles.muted} role="status" aria-live="polite">
          {overLimit
            ? `서버 실행 한도(${REVIEW_ACTION_LIMIT_SECONDS}초)를 넘었습니다. 완료·실패 여부는 새로고침 후 이 카드의 상태나 리뷰 목록에서 확인하세요. 다시 요청하지 마세요.`
            : 'AI 심사를 실행하고 있습니다. 보통 2~3분 걸립니다. 버튼을 다시 누르지 마세요. 완료되면 결과 화면으로 이동합니다.'}
        </p>
      ) : null}
      {settledWithoutNavigation && !pending ? (
        <p className={styles.muted} role="status" aria-live="polite">
          응답을 받았지만 화면이 이동하지 않았습니다. 실제 상태를 다시 읽어 오세요.{' '}
          <button className={styles.button} type="button" onClick={() => router.refresh()}>상태 새로고침</button>
        </p>
      ) : null}
    </>
  );
}
