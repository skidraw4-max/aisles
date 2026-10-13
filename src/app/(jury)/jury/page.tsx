import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { JuryLanding } from '@/components/jury/JuryLanding';
import { juryEntrySurface } from '@/components/jury/entry';
import { juryHref } from '@/lib/jury-product/jury-url';
import { JuryChrome, DashboardBody } from './ui';
import { loadJuryShell, readJurySessionEmail } from './load';

export default async function JuryDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  if (notice === 'EMAIL_UNVERIFIED') {
    return <JuryEmailNotice email={await readJurySessionEmail()} />;
  }
  if (!actor.ok && actor.reason === 'NO_MEMBERSHIP') redirect(juryHref('/organization/create'));
  if (juryEntrySurface(actor) === 'landing') {
    return <JuryLanding />;
  }
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <DashboardBody view={view} /> : null}
    </JuryChrome>
  );
}
