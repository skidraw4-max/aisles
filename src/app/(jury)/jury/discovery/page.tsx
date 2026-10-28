import { notFound } from 'next/navigation';
import { juryDevUi } from '@/lib/jury-product/dev-ui';
import { DiscoveryBody, JuryChrome } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryDiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  if (!juryDevUi()) notFound();
  const { actor, view, notice } = await loadJuryShell(searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <DiscoveryBody actor={actor} view={view} /> : null}
    </JuryChrome>
  );
}
