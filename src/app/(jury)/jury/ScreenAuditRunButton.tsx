'use client';
import * as React from 'react';
import type { runScreenAuditAction } from './screen-audit-actions';
import { Play, RefreshCw, RotateCcw } from 'lucide-react';
import { STATUS_LABEL } from '@/lib/jury-product/services/screen-audit/view-model';
import { Button, type ButtonVariant } from './jury-controls';

/** I-087: icon names (functions cannot cross the server → client boundary). */
const ICONS = { play: Play, refresh: RefreshCw, recheck: RotateCcw } as const;

export function ScreenAuditRunButton(props: {
  connectionId: string;
  parentAuditId?: string | null;
  label: string;
  action: typeof runScreenAuditAction;
  className?: string;
  variant?: ButtonVariant;
  icon?: keyof typeof ICONS;
}) {
  const [result, formAction, pending] = React.useActionState(props.action, null);
  // I-098: let BuildVersionNotice re-check the live build after an audit (stale-tab prompt).
  React.useEffect(() => {
    if (result) window.dispatchEvent(new Event('jury:audit-finished'));
  }, [result]);
  return (
    <form action={formAction}>
      <input type="hidden" name="connectionId" value={props.connectionId} />
      {props.parentAuditId ? <input type="hidden" name="parentAuditId" value={props.parentAuditId} /> : null}
      <Button type="submit" variant={props.variant ?? 'primary'} icon={props.icon ? ICONS[props.icon] : undefined} disabled={pending} aria-busy={pending || undefined} className={props.className}>
        {pending ? '심사 중… (최대 5분)' : props.label}
      </Button>
      {result ? (
        <p role="status">
          {result.ok ? `완료: ${STATUS_LABEL[result.status] ?? result.status}, 발견 ${result.findings}건` : `실행하지 못했어요 (${result.reason}).`}
        </p>
      ) : null}
    </form>
  );
}
