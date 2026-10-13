import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { JuryLoginForm } from '@/components/jury/JuryLoginForm';
import { juryReturnQuery } from '@/lib/jury-product/jury-url';
import { JURY_LOGIN_STORE_UNAVAILABLE_NOTICE, juryLoginErrorNotice } from '@/lib/auth/account-email-conflict';
import { juryLoginOutcome } from '@/lib/jury-product/jury-login-entry';
import { getJuryEntry } from '@/lib/jury-product/session';

export const metadata: Metadata = {
  title: 'Sign in — AIsles Jury',
};

export default async function JuryLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const requested = typeof params.next === 'string' ? params.next : null;
  const returnQuery = juryReturnQuery(requested);
  const entry = await getJuryEntry();
  const outcome = juryLoginOutcome(entry, returnQuery);
  if (outcome.kind === 'redirect') redirect(outcome.href);
  return (
    <JuryLoginForm
      returnQuery={returnQuery}
      notice={juryLoginErrorNotice(typeof params.error === 'string' ? params.error : null) ?? (outcome.notice === 'STORE_UNAVAILABLE' ? JURY_LOGIN_STORE_UNAVAILABLE_NOTICE : outcome.notice === 'EMAIL_UNVERIFIED' ? '이메일 인증이 필요합니다.' : undefined)}
    />
  );
}
