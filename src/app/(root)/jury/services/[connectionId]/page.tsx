import { GithubRefreshStatus } from '../../github-refresh-status';
import { ServiceDetailBody } from '../../service-onboarding-ui';
import { JuryChrome } from '../../ui';
import { loadJuryShell } from '../../load';

export default async function ServiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { connectionId } = await params;
  const { actor, view, notice } = await loadJuryShell(searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {actor.ok && view ? <ServiceDetailBody actor={actor} view={view} connectionId={connectionId} /> : null}
      <GithubRefreshStatus connectionId={connectionId} />
    </JuryChrome>
  );
}
