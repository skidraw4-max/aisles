import { AuditBody, JuryChrome } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <AuditBody view={view} /> : null}
    </JuryChrome>
  );
}
