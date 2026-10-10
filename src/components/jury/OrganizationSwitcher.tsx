'use client';

import Link from 'next/link';
import { switchJuryOrganization } from '@/app/(root)/jury/organization/actions';
import type { JuryOrganizationOption } from '@/lib/jury-product/organization-switch';
import { juryHref } from '@/lib/jury-product/jury-url';
import styles from './organization-switcher.module.css';

export function OrganizationSwitcher({
  organizations,
  activeTenantId,
}: {
  organizations: readonly JuryOrganizationOption[];
  activeTenantId: string;
}) {
  if (organizations.length === 0) return null;
  const active = organizations.some((row) => row.tenantId === activeTenantId) ? activeTenantId : organizations[0].tenantId;
  return (
    <div className={styles.switcher}>
      <form action={switchJuryOrganization}>
        <label className={styles.label}>
          Organization
          <select
            name="tenantId"
            defaultValue={active}
            aria-label="Organization"
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {organizations.map((organization) => (
              <option key={organization.tenantId} value={organization.tenantId}>
                {organization.name}
              </option>
            ))}
          </select>
        </label>
      </form>
      <Link className={styles.create} href={juryHref('/organization/create')}>
        Create organization
      </Link>
    </div>
  );
}
