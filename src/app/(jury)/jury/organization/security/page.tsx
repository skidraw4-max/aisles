import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import listStyles from '@/components/jury/invitation.module.css';
import { juryHref, juryLoginHref } from '@/lib/jury-product/jury-url';
import { organizationSecurityOverview } from '@/lib/jury-product/organization-security';
import { getJuryEntry } from '@/lib/jury-product/session';
import { JuryChrome } from '../../ui';
import { readJurySessionEmail } from '../../load';

export const metadata: Metadata = {
  title: 'Security — AIsles Jury',
};

const SECTIONS = [
  ['authentication', 'Authentication'],
  ['organizationAccess', 'Organization access'],
  ['audit', 'Audit'],
  ['serviceAccess', 'Service access'],
  ['dangerZone', 'Danger zone'],
] as const;

export default async function JuryOrganizationSecurityPage() {
  const entry = await getJuryEntry();
  if (!entry.ok && entry.reason === 'EMAIL_UNVERIFIED') {
    return <JuryEmailNotice email={await readJurySessionEmail()} />;
  }
  if (!entry.ok && entry.reason === 'UNAUTHENTICATED') redirect(juryLoginHref('/jury/organization/security'));
  if (!entry.ok && entry.reason === 'NO_MEMBERSHIP') redirect(juryHref('/organization/create'));
  const overview = organizationSecurityOverview();
  return (
    <JuryChrome actor={entry}>
      <h2>Organization security</h2>
      <p className={listStyles.empty}>This page shows the current policy. These settings cannot be changed here.</p>
      {SECTIONS.map(([key, title]) => (
        <section key={key}>
          <h3>{title}</h3>
          <table className={listStyles.table}>
            <tbody>
              {overview[key].map((item) => (
                <tr key={item.label}>
                  <th>{item.label}</th>
                  <td>{item.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </JuryChrome>
  );
}
