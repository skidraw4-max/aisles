import type { Metadata } from 'next';
import { formatKstFull } from '../../review-summary-format';
import { displayText } from '@/lib/jury-product/ui-labels';
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
  title: '초대 — AIsles Jury',
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
          {invitations.length === 0 ? <p className={listStyles.empty}>아직 초대가 없어요.</p> : (
            <div className={listStyles.tableWrap}>
            <table className={listStyles.table}>
              <thead>
                <tr>
                  <th>이메일</th>
                  <th>역할</th>
                  <th>상태</th>
                  <th>만료</th>
                  <th>생성일</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td><span className={listStyles.ellipsisText} title={invitation.email}>{invitation.email}</span></td>
                    <td className={listStyles.nowrapCell}>{displayText(invitation.role)}</td>
                    <td className={listStyles.nowrapCell}>{displayText(invitation.status)}</td>
                    <td className={listStyles.nowrapCell}>{formatKstFull(invitation.expiresAt)}</td>
                    <td className={listStyles.nowrapCell}>{formatKstFull(invitation.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </>
      ) : <p role="alert">초대 권한이 없어요</p>}
    </JuryChrome>
  );
}
