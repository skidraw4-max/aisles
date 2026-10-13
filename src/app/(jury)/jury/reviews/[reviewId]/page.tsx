import { isJuryStoreUnavailable } from '@/lib/jury-product/jury-db';
import { loadReviewConsole } from '@/lib/jury-product/review-console';
import { guardReviewFeature } from '@/lib/jury-product/service-feature-guard';
import { getJuryActor } from '@/lib/jury-product/session';
import { FollowingReReviewBody, HumanChangeGateBody, HumanReReviewBody, JuryChrome, ReReviewAgentHandoffBody, ReReviewAgentRunBody, ReReviewChangeGateBody, ReviewDetailBody, LaterAgentRunBody, LaterChangeGateBody, LaterImprovementApprovalBody, LaterImprovementBody, LaterImprovementHandoffBody, LaterReReviewBody, SecondChangeGateBody, SecondImprovementApprovalBody, SecondImprovementBody, SecondImprovementHandoffBody, SecondReReviewBody } from '../../ui';

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
    return (
      <JuryChrome actor={actor}>
        {loaded.ok ? (
          <>
            <ReviewDetailBody screen={loaded.screen} noted={noted} />
            <HumanChangeGateBody screen={loaded.screen} />
            <HumanReReviewBody screen={loaded.screen} />
            <ReReviewAgentHandoffBody screen={loaded.screen} />
            <ReReviewAgentRunBody screen={loaded.screen} />
            <ReReviewChangeGateBody screen={loaded.screen} />
            <SecondReReviewBody screen={loaded.screen} />
            <SecondImprovementBody screen={loaded.screen} />
            <SecondImprovementApprovalBody screen={loaded.screen} />
            <SecondImprovementHandoffBody screen={loaded.screen} />
            <SecondChangeGateBody screen={loaded.screen} />
            <LaterReReviewBody screen={loaded.screen} />
            <LaterImprovementBody screen={loaded.screen} />
            <LaterImprovementApprovalBody screen={loaded.screen} />
            <LaterImprovementHandoffBody screen={loaded.screen} />
            <LaterAgentRunBody screen={loaded.screen} />
            <LaterChangeGateBody screen={loaded.screen} />
            <FollowingReReviewBody screen={loaded.screen} />
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
