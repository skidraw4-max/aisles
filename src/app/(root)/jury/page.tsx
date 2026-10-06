import { JuryChrome, DashboardBody } from './ui';
import { loadJuryShell } from './load';

export default async function JuryDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <DashboardBody view={view} /> : null}
    </JuryChrome>
  );
}
