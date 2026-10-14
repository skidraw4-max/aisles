import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import {
  JuryServiceMemberAdd,
  JuryServicePermissionControl,
  JuryServiceRemoveControl,
} from '@/components/jury/JuryServiceAccess';
import listStyles from '@/components/jury/invitation.module.css';
import { juryHref, juryLoginHref } from '@/lib/jury-product/jury-url';
import { juryRoleLabel } from '@/lib/jury-product/member-management';
import { canManageServiceAccess, SERVICE_PERMISSION_LABEL } from '@/lib/jury-product/service-member-management';
import { listServiceAccess } from '@/lib/jury-product/service-member-db';
import { getJuryEntry } from '@/lib/jury-product/session';
import { JuryChrome } from '../../ui';
import { readJurySessionEmail } from '../../load';

export const metadata: Metadata = {
  title: 'Service access — AIsles Jury',
};

export default async function JuryServiceAccessPage() {
  const entry = await getJuryEntry();
  if (!entry.ok && entry.reason === 'EMAIL_UNVERIFIED') {
    return <JuryEmailNotice email={await readJurySessionEmail()} />;
  }
  if (!entry.ok && entry.reason === 'UNAUTHENTICATED') redirect(juryLoginHref('/jury/organization/services'));
  if (!entry.ok && entry.reason === 'NO_MEMBERSHIP') redirect(juryHref('/organization/create'));
  const actor = entry;
  const manage = canManageServiceAccess(actor);
  const services = actor.ok ? await listServiceAccess(actor.tenantId).catch(() => []) : [];
  return (
    <JuryChrome actor={actor}>
      <h2>Service access</h2>
      {services.length === 0 ? <p className={listStyles.empty}>No services connected yet.</p> : services.map((service) => (
        <section key={service.connectionId}>
          <h3>{service.displayName}</h3>
          <p className={listStyles.empty}>
            Status: {service.status || 'Unknown'}
            {' · '}
            Connected: {service.createdAt ? service.createdAt.slice(0, 16).replace('T', ' ') : 'Unknown'}
            {' · '}
            Members: {service.memberCount}
          </p>
          {service.members.length === 0 ? <p className={listStyles.empty}>No service members yet.</p> : (
            <table className={listStyles.table}>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Email</th>
                  <th>Organization role</th>
                  <th>Permission</th>
                  <th>Granted</th>
                </tr>
              </thead>
              <tbody>
                {service.members.map((member) => (
                  <tr key={member.userId}>
                    <td>{member.displayName ?? member.email}</td>
                    <td>{member.email}</td>
                    <td>{member.orgRole ? juryRoleLabel(member.orgRole) : 'No organization membership'}</td>
                    <td>
                      {manage ? (
                        <>
                          <JuryServicePermissionControl
                            connectionId={service.connectionId}
                            memberUserId={member.userId}
                            permission={member.permission}
                          />
                          <JuryServiceRemoveControl
                            connectionId={service.connectionId}
                            memberUserId={member.userId}
                            email={member.email}
                            serviceName={service.displayName}
                            permissionLabel={SERVICE_PERMISSION_LABEL[member.permission]}
                          />
                        </>
                      ) : SERVICE_PERMISSION_LABEL[member.permission]}
                    </td>
                    <td>{member.grantedAt ? member.grantedAt.slice(0, 16).replace('T', ' ') : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {manage ? <JuryServiceMemberAdd connectionId={service.connectionId} candidates={service.candidates} /> : null}
        </section>
      ))}
    </JuryChrome>
  );
}
