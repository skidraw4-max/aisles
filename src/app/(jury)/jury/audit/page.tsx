import { readListQuery } from '@/lib/jury-product/list-paging';
import { AuditBody, JuryChrome } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[]; q?: string | string[]; filter?: string | string[]; page?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  const query = readListQuery(await searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <AuditBody view={view} query={query} /> : null}
    </JuryChrome>
  );
}
