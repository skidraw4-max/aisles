import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { JuryInvitationForm } from '@/components/jury/JuryInvitationForm';
import listStyles from '@/components/jury/invitation.module.css';
import { decideJuryMutation } from '@/lib/jury-product/access';
import { listTenantInvitations } from '@/lib/jury-product/jury-db';
import { juryHref, juryLoginHref } from '@/lib/jury-product/jury-url';
import { getJuryEntry } from '@/lib/jury-product/session';
import { JuryChrome } from '../../ui';
import { readJurySessionEmail } from '../../load';

export const metadata: Metadata = {
  title: 'Invitations — AIsles Jury',
};

export default async function JuryInvitationsPage() {
  const entry = await getJuryEntry();
  if (!entry.ok && entry.reason === 'EMAIL_UNVERIFIED') {
    return <JuryEmailNotice email={await readJurySessionEmail()} />;
  }
  if (!entry.ok && entry.reason === 'UNAUTHENTICATED') {
    redirect(juryLoginHref('/jury/organization/invitations'));
  }
  if (!entry.ok && entry.reason === 'NO_MEMBERSHIP') redirect(juryHref('/organization/create'));
  const actor = entry;
  const allowed = actor.ok && decideJuryMutation({
    actor,
    action: 'membership.write',
    resourceTenantId: actor.tenantId,
  }).ok;
  const invitations = allowed && actor.ok ? await listTenantInvitations(actor.tenantId).catch(() => []) : [];
  return (
    <JuryChrome actor={actor}>
      {allowed ? (
        <>
          <JuryInvitationForm />
          {invitations.length === 0 ? <p className={listStyles.empty}>No invitations yet.</p> : (
            <table className={listStyles.table}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.email}</td>
                    <td>{invitation.role}</td>
                    <td>{invitation.status}</td>
                    <td>{invitation.expiresAt}</td>
                    <td>{invitation.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : <p role="alert">Not authorized to invite</p>}
    </JuryChrome>
  );
}
