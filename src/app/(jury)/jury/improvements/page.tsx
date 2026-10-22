import { loadProductChangeGateStates } from '@/lib/jury-product/product-change-gate';
import { loadProductReReviewStates } from '@/lib/jury-product/product-change-gate-rereview';
import { loadProductExecutionSummaries } from '@/lib/jury-product/product-execution';
import { loadProductImprovementApprovals } from '@/lib/jury-product/product-handoff';
import { ImprovementsBody, JuryChrome } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryImprovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  const approvals = view ? await loadProductImprovementApprovals(view.tenantId) : {};
  const summaries = view ? await loadProductExecutionSummaries(view.tenantId) : {};
  const gates = view ? await loadProductChangeGateStates(view.tenantId) : {};
  const reReviews = view ? await loadProductReReviewStates(view.tenantId) : {};
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <ImprovementsBody actor={actor} view={view} approvals={approvals} summaries={summaries} gates={gates} reReviews={reReviews} /> : null}
    </JuryChrome>
  );
}
