import { EvidenceBody, JuryChrome } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryEvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <EvidenceBody actor={actor} view={view} /> : null}
    </JuryChrome>
  );
}
