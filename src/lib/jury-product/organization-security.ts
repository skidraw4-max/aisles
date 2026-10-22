import { INVITATION_TTL_MS } from './organization-invitation';

export type SecurityFact = {
  label: string;
  value: string;
  mutable: false;
};

export type OrganizationSecurityOverview = {
  authentication: SecurityFact[];
  organizationAccess: SecurityFact[];
  audit: SecurityFact[];
  serviceAccess: SecurityFact[];
  dangerZone: SecurityFact[];
};

function fact(label: string, value: string): SecurityFact {
  return { label, value, mutable: false };
}

/** Current policy display. This phase does not persist security setting changes. */
export function organizationSecurityOverview(): OrganizationSecurityOverview {
  const invitationDays = Math.round(INVITATION_TTL_MS / (24 * 60 * 60 * 1000));
  return {
    authentication: [
      fact('Email verification', 'Required'),
      fact('Google sign-in', 'Available'),
    ],
    organizationAccess: [
      fact('Organization roles', 'Enabled'),
      fact('Service-level permissions', 'Enabled'),
      fact('Invitations', 'Enabled'),
      fact('Invitation expiry', `${invitationDays} days`),
    ],
    audit: [
      fact('Organization role changes', 'Audited'),
      fact('Service access changes', 'Audited'),
      fact('Invitations', 'Audited'),
    ],
    serviceAccess: [
      fact('Service-level access control', 'Enabled'),
      fact('AGENT permission requires explicit grant', 'Enabled'),
    ],
    dangerZone: [
      fact('Owner transfer', 'Not available yet'),
    ],
  };
}
