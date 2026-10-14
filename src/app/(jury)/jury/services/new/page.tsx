import { AddServiceBody } from '../../service-onboarding-ui';
import { JuryChrome } from '../../ui';
import { loadJuryShell } from '../../load';

export default async function AddServicePage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, notice } = await loadJuryShell(searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {actor.ok ? <AddServiceBody actor={actor} /> : null}
    </JuryChrome>
  );
}
