import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { JuryMemberRemoveControl, JuryMemberRoleControl } from '@/components/jury/JuryMemberControls';
import listStyles from '@/components/jury/invitation.module.css';
import { decideJuryMutation } from '@/lib/jury-product/access';
import { listOrganizationMembers } from '@/lib/jury-product/jury-db';
import { countOrganizationServiceAccess } from '@/lib/jury-product/service-member-db';
import { juryHref, juryLoginHref } from '@/lib/jury-product/jury-url';
import { canManageMember, juryRoleLabel } from '@/lib/jury-product/member-management';
import { getJuryEntry } from '@/lib/jury-product/session';
import { JuryChrome } from '../../ui';
import { readJurySessionEmail } from '../../load';

export const metadata: Metadata = {
  title: 'Members — AIsles Jury',
};

const ASSIGNABLE = new Set(['ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER']);

export default async function JuryMembersPage() {
  const entry = await getJuryEntry();
  if (!entry.ok && entry.reason === 'EMAIL_UNVERIFIED') {
    return <JuryEmailNotice email={await readJurySessionEmail()} />;
  }
  if (!entry.ok && entry.reason === 'UNAUTHENTICATED') redirect(juryLoginHref('/jury/organization/members'));
  if (!entry.ok && entry.reason === 'NO_MEMBERSHIP') redirect(juryHref('/organization/create'));
  const actor = entry;
  const canInvite = actor.ok && decideJuryMutation({
    actor,
    action: 'membership.write',
    resourceTenantId: actor.tenantId,
  }).ok;
  const members = actor.ok ? await listOrganizationMembers(actor.tenantId).catch(() => []) : [];
  const serviceAccess: Record<string, number> = actor.ok
    ? await countOrganizationServiceAccess(actor.tenantId).catch(() => ({}))
    : {};
  return (
    <JuryChrome actor={actor}>
      <h2>Members</h2>
      {canInvite ? <p><Link href={juryHref('/organization/invitations')}>Invite member</Link></p> : null}
      {members.length === 0 ? <p className={listStyles.empty}>No members yet.</p> : (
        <table className={listStyles.table}>
          <thead>
            <tr>
              <th>Member</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
              <th>Service access</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const manageable = actor.ok && canManageMember(actor, {
                userId: member.userId,
                tenantId: actor.tenantId,
                role: member.role,
              });
              return (
                <tr key={member.membershipId}>
                  <td>{member.displayName ?? member.email}</td>
                  <td>{member.email}</td>
                  <td>{juryRoleLabel(member.role)}</td>
                  <td>{member.joinedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>{serviceAccess[member.userId] ?? 0}</td>
                  <td>
                    {manageable && ASSIGNABLE.has(member.role) ? (
                      <>
                        <JuryMemberRoleControl memberUserId={member.userId} role={member.role as 'ADMIN' | 'REVIEWER' | 'DEVELOPER' | 'VIEWER'} />
                        <JuryMemberRemoveControl memberUserId={member.userId} email={member.email} roleLabel={juryRoleLabel(member.role)} />
                      </>
                    ) : <span>{juryRoleLabel(member.role)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </JuryChrome>
  );
}
