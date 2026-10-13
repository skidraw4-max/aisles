import { DiscoveryBody, JuryChrome } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryDiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <DiscoveryBody actor={actor} view={view} /> : null}
    </JuryChrome>
  );
}
