import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { JuryLoginForm } from '@/components/jury/JuryLoginForm';
import { juryReturnQuery, safeJuryNext } from '@/lib/jury-product/jury-url';
import { getJuryEntry } from '@/lib/jury-product/session';

export const metadata: Metadata = {
  title: 'Sign in — AIsles Jury',
};

export default async function JuryLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const requested = typeof params.next === 'string' ? params.next : null;
  const returnQuery = juryReturnQuery(requested);
  const entry = await getJuryEntry();
  if (entry.ok) redirect(safeJuryNext(returnQuery));
  return (
    <JuryLoginForm
      returnQuery={returnQuery}
      notice={entry.reason === 'EMAIL_UNVERIFIED' ? '이메일 인증이 필요합니다.' : undefined}
    />
  );
}
