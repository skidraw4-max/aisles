import { readListQuery } from '@/lib/jury-product/list-paging';
import { EvidenceBody, JuryChrome } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryEvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[]; q?: string | string[]; filter?: string | string[]; page?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams, { attempts: true });
  const query = readListQuery(await searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <EvidenceBody actor={actor} view={view} query={query} /> : null}
    </JuryChrome>
  );
}
