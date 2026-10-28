'use client';
/**
 * I-099: "이 결과로 위원 심사하기" — collects evidence with the default period and starts the Jury review in one click,
 * shows 3-step progress (화면 심사 → 위원 심사 → 개선 제안) and opens the result at #improvement-proposals.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Gavel } from 'lucide-react';
import type { pollAuditJuryReviewAction, startAuditJuryReviewAction } from './actions';
import { auditJuryResultHref, auditJurySteps, type AuditJuryPhase } from '@/lib/jury-product/services/screen-audit/audit-jury-ui';
import { Button } from './jury-controls';

const POLL_MS = 4000;
const STEP_MARK = { done: '✓', active: '…', todo: '·', failed: '✕' } as const;

export function AuditJuryReviewButton(props: {
  connectionId: string;
  disabledReason: string | null;
  start: typeof startAuditJuryReviewAction;
  poll: typeof pollAuditJuryReviewAction;
}) {
  const router = useRouter();
  const [phase, setPhase] = React.useState<AuditJuryPhase>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const finish = (resultId: string) => {
    setPhase('done');
    router.push(auditJuryResultHref(resultId));
  };
  const fail = (reason: string) => {
    setPhase('failed');
    setError(reason);
  };
  const pollLoop = (requestId: string) => {
    timer.current = setTimeout(async () => {
      const r = await props.poll(requestId);
      if (r.state === 'COMPLETED') return finish(r.resultId);
      if (r.state === 'RUNNING') {
        setElapsed(r.elapsedMs);
        return pollLoop(requestId);
      }
      fail(r.state === 'FAILED' ? r.reason : 'NOT_FOUND');
    }, POLL_MS);
  };
  const onClick = async () => {
    setPhase('starting');
    setError(null);
    setElapsed(0);
    const r = await props.start(props.connectionId);
    if (!r.ok) return fail(r.reason);
    if (r.state === 'COMPLETED') return finish(r.resultId);
    setPhase('running');
    pollLoop(r.requestId);
  };

  const busy = phase === 'starting' || phase === 'running' || phase === 'done';
  const disabled = Boolean(props.disabledReason) || busy;
  return (
    <div role="group" aria-label="위원 심사" data-testid="audit-jury-review">
      <Button type="button" variant="primary" icon={Gavel} disabled={disabled} aria-busy={busy || undefined} onClick={onClick}>
        {phase === 'starting' ? '근거 수집 중…' : phase === 'running' ? '위원 심사 중…' : phase === 'done' ? '결과 여는 중…' : '이 결과로 위원 심사하기'}
      </Button>
      {props.disabledReason ? <p role="note">{props.disabledReason}</p> : null}
      {phase !== 'idle' ? (
        <ol aria-label="진행 단계" style={{ display: 'flex', gap: 16, listStyle: 'none', padding: 0, margin: '8px 0' }}>
          {auditJurySteps(phase).map((s) => (
            <li key={s.label} aria-current={s.state === 'active' ? 'step' : undefined} style={{ opacity: s.state === 'todo' ? 0.5 : 1 }}>
              {STEP_MARK[s.state]} {s.label}
              {s.label === '위원 심사' && s.state === 'active' && elapsed > 0 ? ` (${Math.round(elapsed / 1000)}초)` : null}
            </li>
          ))}
        </ol>
      ) : null}
      {phase === 'running' || phase === 'starting' ? <p role="status">위원 5명이 근거를 검토하고 있어요. 보통 1~4분 걸리고, 이 화면을 떠나도 심사는 계속됩니다.</p> : null}
      {error ? <p role="alert">위원 심사를 끝내지 못했습니다 ({error}). 잠시 후 다시 눌러 주세요.</p> : null}
    </div>
  );
}
