import { JuryChrome, ServicesBody } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <ServicesBody actor={actor} view={view} /> : null}
    </JuryChrome>
  );
}
