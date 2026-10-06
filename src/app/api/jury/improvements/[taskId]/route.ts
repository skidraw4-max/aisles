import { NextResponse } from 'next/server';
import { isJuryStoreUnavailable } from '@/lib/jury-product/jury-db';
import { improvementTraceQuery, projectImprovementTrace, traceReadHttpStatus } from '@/lib/jury-product/improvement-trace-console';
import { readImprovementTrace } from '@/lib/jury-product/improvement-trace-store';
import { getJuryActor } from '@/lib/jury-product/session';

export async function GET(_req: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const actor = await getJuryActor();
  const query = improvementTraceQuery(actor, taskId, null);
  if (!query.ok) {
    return NextResponse.json({ ok: false, reason: query.reason }, { status: traceReadHttpStatus(query.reason) });
  }
  try {
    const trace = await readImprovementTrace(query.input);
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
