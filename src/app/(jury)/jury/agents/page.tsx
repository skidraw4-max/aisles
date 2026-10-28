import { notFound } from 'next/navigation';
import { juryDevUi } from '@/lib/jury-product/dev-ui';
import { AgentsBody, JuryChrome } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  if (!juryDevUi()) notFound();
  const { actor, view, notice } = await loadJuryShell(searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <AgentsBody actor={actor} view={view} /> : null}
    </JuryChrome>
  );
}
