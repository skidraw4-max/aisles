import { isJuryStoreUnavailable } from '@/lib/jury-product/jury-db';
import { loadReviewConsole, restrictReviewConsoleScreen, reviewConsoleSections } from '@/lib/jury-product/review-console';
import { guardReviewFeature } from '@/lib/jury-product/service-feature-guard';
import { getJuryActor } from '@/lib/jury-product/session';
import { FollowingReReviewBody, HumanChangeGateBody, HumanReReviewBody, JuryChrome, ReReviewAgentHandoffBody, ReReviewNextImprovementBody, ReReviewAgentRunBody, ReReviewChangeGateBody, ReviewDetailBody, LaterAgentRunBody, LaterChangeGateBody, LaterImprovementApprovalBody, LaterImprovementBody, LaterImprovementHandoffBody, LaterReReviewBody, SecondChangeGateBody, SecondImprovementApprovalBody, SecondImprovementBody, SecondImprovementHandoffBody, SecondReReviewBody } from '../../ui';

export default async function JuryReviewDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ reviewId: string }>;
  searchParams: Promise<{ human?: string | string[] }>;
}) {
  const { reviewId } = await params;
  const noted = (await searchParams).human === 'NOTED';
  const actor = await getJuryActor();
  if (!actor.ok) {
    return (
      <JuryChrome actor={actor}>
        {null}
      </JuryChrome>
    );
  }
  try {
    const access = await guardReviewFeature(actor, reviewId, 'review.read');
    const loaded = access.ok ? await loadReviewConsole(actor, reviewId) : { ok: false as const, reason: 'NOT_FOUND' as const };
    const [improvementAccess, agentAccess] = loaded.ok
      ? await Promise.all([
          guardReviewFeature(actor, reviewId, 'improvement.read'),
          guardReviewFeature(actor, reviewId, 'agent.execute'),
        ])
      : [null, null];
    const blocks = { improvement: improvementAccess?.ok === true, agent: agentAccess?.ok === true };
    const screen = loaded.ok ? restrictReviewConsoleScreen(loaded.screen, blocks) : null;
    const show = screen ? reviewConsoleSections(screen, blocks) : null;
    return (
      <JuryChrome actor={actor}>
        {screen && show ? (
          <>
            <ReviewDetailBody screen={screen} noted={noted} />
            {show.HumanChangeGate ? <HumanChangeGateBody screen={screen} /> : null}
            {show.HumanReReview ? <HumanReReviewBody screen={screen} /> : null}
            {show.ReReviewNextImprovement ? <ReReviewNextImprovementBody screen={screen} /> : null}
            {show.ReReviewAgentHandoff ? <ReReviewAgentHandoffBody screen={screen} /> : null}
            {show.ReReviewAgentRun ? <ReReviewAgentRunBody screen={screen} /> : null}
            {show.ReReviewChangeGate ? <ReReviewChangeGateBody screen={screen} /> : null}
            {show.SecondReReview ? <SecondReReviewBody screen={screen} /> : null}
            {show.SecondImprovement ? <SecondImprovementBody screen={screen} /> : null}
            {show.SecondImprovementApproval ? <SecondImprovementApprovalBody screen={screen} /> : null}
            {show.SecondImprovementHandoff ? <SecondImprovementHandoffBody screen={screen} /> : null}
            {show.SecondChangeGate ? <SecondChangeGateBody screen={screen} /> : null}
            {show.LaterReReview ? <LaterReReviewBody screen={screen} /> : null}
            {show.LaterImprovement ? <LaterImprovementBody screen={screen} /> : null}
            {show.LaterImprovementApproval ? <LaterImprovementApprovalBody screen={screen} /> : null}
            {show.LaterImprovementHandoff ? <LaterImprovementHandoffBody screen={screen} /> : null}
            {show.LaterAgentRun ? <LaterAgentRunBody screen={screen} /> : null}
            {show.LaterChangeGate ? <LaterChangeGateBody screen={screen} /> : null}
            {show.FollowingReReview ? <FollowingReReviewBody screen={screen} /> : null}
          </>
        ) : (
          <p>{!access.ok && access.reason === 'FORBIDDEN' ? 'Not authorized' : '이 tenant에서 해당 Review를 찾을 수 없습니다.'}</p>
        )}
      </JuryChrome>
    );
  } catch (error) {
    if (isJuryStoreUnavailable(error)) {
      return (
        <JuryChrome actor={{ ok: false, reason: 'STORE_UNAVAILABLE' }}>
          {null}
        </JuryChrome>
      );
    }
    throw error;
  }
}
