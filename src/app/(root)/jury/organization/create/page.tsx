import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { JuryOrganizationForm } from '@/components/jury/JuryOrganizationForm';
import { juryHref } from '@/lib/jury-product/jury-url';
import { getJuryEntry } from '@/lib/jury-product/session';
import { readJurySessionEmail } from '../../load';

export const metadata: Metadata = {
  title: 'Create your organization — AIsles Jury',
};

export default async function JuryOrganizationCreatePage() {
  const entry = await getJuryEntry();
  if (!entry.ok && entry.reason === 'EMAIL_UNVERIFIED') {
    return <JuryEmailNotice email={await readJurySessionEmail()} />;
  }
  if (!entry.ok && (entry.reason === 'UNAUTHENTICATED' || entry.reason === 'STORE_UNAVAILABLE')) {
    redirect(juryHref('/login'));
  }
  return <JuryOrganizationForm />;
}
