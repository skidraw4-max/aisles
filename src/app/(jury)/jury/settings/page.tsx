import { readConsoleLoopOperations } from '@/lib/jury-product/console-loop-operations-store';
import { listMembershipsForTenant } from '@/lib/jury-product/jury-db';
import { JuryChrome, SettingsBody } from '../ui';
import { loadJuryShell, loadShellIdentity } from '../load';

export default async function JurySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  const members = actor.ok && view ? await listMembershipsForTenant(actor.tenantId) : [];
  const identity = actor.ok ? await loadShellIdentity(actor) : null;
  const loop = actor.ok ? await readConsoleLoopOperations(actor) : null;
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? (
        <SettingsBody
          actor={actor}
          view={view}
          members={members}
          tenantName={identity?.tenantName ?? null}
          loop={loop?.ok ? loop.screen : null}
        />
      ) : null}
    </JuryChrome>
  );
}
