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
import { PageHeader } from '../../page-layout';
import { readJurySessionEmail } from '../../load';
import { formatKstFull } from '../../review-summary-format';
import { displayText } from '@/lib/jury-product/ui-labels';

export const metadata: Metadata = {
  title: '서비스 접근 권한 — AIsles Jury',
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
      <PageHeader crumbs={[{ label: '홈', href: juryHref('/') }, { label: '관리' }, { label: '서비스 접근 권한' }]} title="서비스 접근 권한" />
      {services.length === 0 ? <p className={listStyles.empty}>아직 연결된 서비스가 없어요.</p> : services.map((service) => (
        <section key={service.connectionId}>
          <h3>{service.displayName}</h3>
          <p className={listStyles.empty}>
            상태: {service.status ? displayText(service.status) : '알 수 없음'}
            {' · '}
            연결 시각: {service.createdAt ? formatKstFull(service.createdAt) : '알 수 없음'}
            {' · '}
            구성원: {service.memberCount}
          </p>
          {service.members.length === 0 ? <p className={listStyles.empty}>아직 서비스 구성원이 없어요.</p> : (
            <div className={listStyles.tableWrap}>
            <table className={listStyles.table}>
              <thead>
                <tr>
                  <th>구성원</th>
                  <th>이메일</th>
                  <th>조직 역할</th>
                  <th>권한</th>
                  <th>부여됨</th>
                </tr>
              </thead>
              <tbody>
                {service.members.map((member) => (
                  <tr key={member.userId}>
                    <td><span className={listStyles.ellipsisText} title={member.displayName ?? member.email}>{member.displayName ?? member.email}</span></td>
                    <td><span className={listStyles.ellipsisText} title={member.email}>{member.email}</span></td>
                    <td className={listStyles.nowrapCell}>{member.orgRole ? juryRoleLabel(member.orgRole) : '조직 구성원 아님'}</td>
                    <td>
                      {manage ? (
                        <div className={listStyles.actionCell}>
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
                        </div>
                      ) : SERVICE_PERMISSION_LABEL[member.permission]}
                    </td>
                    <td className={listStyles.nowrapCell}>{member.grantedAt ? member.grantedAt.slice(0, 16).replace('T', ' ') : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {manage ? <JuryServiceMemberAdd connectionId={service.connectionId} candidates={service.candidates} /> : null}
        </section>
      ))}
    </JuryChrome>
  );
}
