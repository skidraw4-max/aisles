import { isJuryStoreUnavailable } from '@/lib/jury-product/jury-db';
import { improvementTraceQuery } from '@/lib/jury-product/improvement-trace-console';
import { readImprovementTrace } from '@/lib/jury-product/improvement-trace-store';
import { externalFeatureDenial } from '@/lib/jury-product/service-feature-authorization';
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
        <p>{externalFeatureDenial(access) === 'FORBIDDEN' ? '이 화면을 볼 권한이 없어요.' : '현재 조직에서 이 개선 작업을 찾을 수 없어요.'}</p>
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
          <p>현재 조직에서 이 개선 작업을 찾을 수 없어요.</p>
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
