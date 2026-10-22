import { NextResponse } from 'next/server';
import { isJuryStoreUnavailable } from '@/lib/jury-product/jury-db';
import { improvementTraceQuery, projectImprovementTrace, readGuardedImprovementTrace, traceReadHttpStatus } from '@/lib/jury-product/improvement-trace-console';
import { readImprovementTrace } from '@/lib/jury-product/improvement-trace-store';
import { guardImprovementFeature } from '@/lib/jury-product/service-feature-guard';
import { getJuryActor } from '@/lib/jury-product/session';

export async function GET(_req: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const actor = await getJuryActor();
  const query = improvementTraceQuery(actor, taskId, null);
  if (!query.ok) {
    return NextResponse.json({ ok: false, reason: query.reason }, { status: traceReadHttpStatus(query.reason) });
  }
  if (!actor.ok) {
    return NextResponse.json({ ok: false, reason: actor.reason }, { status: traceReadHttpStatus(actor.reason) });
  }
  try {
    const guarded = await readGuardedImprovementTrace({
      actor,
      taskId,
      guard: guardImprovementFeature,
      read: () => readImprovementTrace(query.input),
    });
    if (!guarded.ok) {
      return NextResponse.json({ ok: false, reason: guarded.reason }, { status: traceReadHttpStatus(guarded.reason) });
    }
    const trace = guarded.value;
    if (!trace.ok) {
      return NextResponse.json({ ok: false, reason: trace.reason }, { status: traceReadHttpStatus(trace.reason) });
    }
    return NextResponse.json({ ok: true, screen: projectImprovementTrace(trace.trace) });
  } catch (error) {
    if (isJuryStoreUnavailable(error)) {
      return NextResponse.json({ ok: false, reason: 'STORE_UNAVAILABLE' }, { status: 503 });
    }
    throw error;
  }
}
