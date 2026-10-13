import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { JurySignupForm } from '@/components/jury/JurySignupForm';
import { juryReturnQuery, safeJuryNext } from '@/lib/jury-product/jury-url';
import { getJuryEntry } from '@/lib/jury-product/session';
import { readJurySessionEmail } from '../load';

export const metadata: Metadata = {
  title: 'Create account — AIsles Jury',
};

export default async function JurySignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const returnQuery = juryReturnQuery(typeof params.next === 'string' ? params.next : null);
  const entry = await getJuryEntry();
  if (entry.ok) redirect(safeJuryNext(returnQuery));
  if (!entry.ok && entry.reason === 'EMAIL_UNVERIFIED') {
    return <JuryEmailNotice email={await readJurySessionEmail()} />;
  }
  return <JurySignupForm returnQuery={returnQuery} />;
}
