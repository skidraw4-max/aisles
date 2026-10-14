import { readConsoleLoopOperations } from '@/lib/jury-product/console-loop-operations-store';
import { AutomationBody, JuryChrome } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryAutomationPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  const loop = actor.ok ? await readConsoleLoopOperations(actor) : null;
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <AutomationBody actor={actor} view={view} loop={loop?.ok ? loop.screen : null} /> : null}
    </JuryChrome>
  );
}
