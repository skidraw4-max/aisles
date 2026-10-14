import { JuryChrome, ReviewsBody } from '../ui';
import { loadJuryShell } from '../load';

export default async function JuryReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { actor, view, notice } = await loadJuryShell(searchParams);
  return (
    <JuryChrome actor={actor} notice={notice}>
      {view ? <ReviewsBody view={view} /> : null}
    </JuryChrome>
  );
}
