'use client';
import * as React from 'react';
import type { ScreenAuditActionResult } from './screen-audit-actions';
import { STATUS_LABEL } from '@/lib/jury-product/services/screen-audit/view-model';

export function ScreenAuditRunButton(props: {
  connectionId: string;
  parentAuditId?: string | null;
  label: string;
  action: (prev: ScreenAuditActionResult, formData: FormData) => Promise<ScreenAuditActionResult>;
  className?: string;
}) {
  const [result, formAction, pending] = React.useActionState(props.action, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="connectionId" value={props.connectionId} />
      {props.parentAuditId ? <input type="hidden" name="parentAuditId" value={props.parentAuditId} /> : null}
      <button type="submit" disabled={pending} className={props.className}>
        {pending ? '심사 중… (최대 5분)' : props.label}
      </button>
      {result ? (
        <p role="status">
          {result.ok ? `완료: ${STATUS_LABEL[result.status] ?? result.status}, 발견 ${result.findings}건` : `실행하지 못했습니다 (${result.reason}).`}
        </p>
      ) : null}
    </form>
  );
}
