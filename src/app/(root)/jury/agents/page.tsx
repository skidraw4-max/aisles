import { AgentsBody, JuryChrome } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <AgentsBody actor={actor} view={view} /> : null}
    </JuryChrome>
  );
}
