import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { JuryMemberRemoveControl, JuryMemberRoleControl } from '@/components/jury/JuryMemberControls';
import listStyles from '@/components/jury/invitation.module.css';
import { decideJuryMutation } from '@/lib/jury-product/access';
import { listOrganizationMembers } from '@/lib/jury-product/jury-db';
import { countOrganizationServiceAccess } from '@/lib/jury-product/service-member-db';
import { juryHref, juryLoginHref } from '@/lib/jury-product/jury-url';
import { canManageMember } from '@/lib/jury-product/member-management';
import { userLabel } from '@/lib/jury-product/ui-labels';
import { getJuryEntry } from '@/lib/jury-product/session';
import { JuryChrome } from '../../ui';
import { PageHeader } from '../../page-layout';
import { ButtonLink } from '../../jury-controls';
import { UserPlus } from 'lucide-react';
import { readJurySessionEmail } from '../../load';

export const metadata: Metadata = {
  title: '구성원 — AIsles Jury',
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
      <PageHeader
        crumbs={[{ label: '홈', href: juryHref('/') }, { label: '관리' }, { label: '구성원' }]}
        title="구성원"
        actions={canInvite ? <ButtonLink variant="primary" icon={UserPlus} href={juryHref('/organization/invitations')}>구성원 초대</ButtonLink> : undefined}
      />
      {members.length === 0 ? <p className={listStyles.empty}>아직 구성원이 없어요.</p> : (
        <div className={listStyles.tableWrap}>
        <table className={listStyles.table}>
          <thead>
            <tr>
              <th>구성원</th>
              <th>이메일</th>
              <th>역할</th>
              <th>가입일</th>
              <th>서비스 접근 권한</th>
              <th>접근</th>
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
                  <td><span className={listStyles.ellipsisText} title={member.displayName ?? member.email}>{member.displayName ?? member.email}</span></td>
                  <td><span className={listStyles.ellipsisText} title={member.email}>{member.email}</span></td>
                  <td className={listStyles.nowrapCell}>{userLabel(member.role)}</td>
                  <td className={listStyles.nowrapCell}>{member.joinedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>{serviceAccess[member.userId] ?? 0}</td>
                  <td>
                    {manageable && ASSIGNABLE.has(member.role) ? (
                      <div className={listStyles.actionCell}>
                        <JuryMemberRoleControl memberUserId={member.userId} role={member.role as 'ADMIN' | 'REVIEWER' | 'DEVELOPER' | 'VIEWER'} />
                        <JuryMemberRemoveControl memberUserId={member.userId} email={member.email} roleLabel={userLabel(member.role)} />
                      </div>
                    ) : <span>{userLabel(member.role)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </JuryChrome>
  );
}
