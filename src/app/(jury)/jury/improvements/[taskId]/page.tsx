import { isJuryStoreUnavailable } from '@/lib/jury-product/jury-db';
import { improvementTraceQuery } from '@/lib/jury-product/improvement-trace-console';
import { readImprovementTrace } from '@/lib/jury-product/improvement-trace-store';
import { guardImprovementFeature } from '@/lib/jury-product/service-feature-guard';
import { getJuryActor } from '@/lib/jury-product/session';
import { ImprovementTraceBody, JuryChrome } from '../../ui';

export default async function JuryImprovementTracePage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const actor = await getJuryActor();
  if (!actor.ok) {
    return <JuryChrome actor={actor}>{null}</JuryChrome>;
  }
  const access = await guardImprovementFeature(actor, taskId, 'improvement.read');
  if (!access.ok) {
    return (
      <JuryChrome actor={actor}>
        <p>{access.reason === 'FORBIDDEN' ? 'Not authorized' : '이 tenant에서 해당 Improvement를 찾을 수 없습니다.'}</p>
      </JuryChrome>
    );
  }
  const query = improvementTraceQuery(actor, taskId, null);
  if (!query.ok) {
    return <JuryChrome actor={actor}>{null}</JuryChrome>;
  }
  try {
    const trace = await readImprovementTrace(query.input);
    if (!trace.ok) {
      return (
        <JuryChrome actor={actor}>
          <p>이 tenant에서 해당 Improvement를 찾을 수 없습니다.</p>
        </JuryChrome>
      );
    }
    return (
      <JuryChrome actor={actor}>
        <ImprovementTraceBody trace={trace.trace} />
      </JuryChrome>
    );
  } catch (error) {
    if (isJuryStoreUnavailable(error)) {
      return <JuryChrome actor={{ ok: false, reason: 'STORE_UNAVAILABLE' }}>{null}</JuryChrome>;
    }
    throw error;
  }
}
