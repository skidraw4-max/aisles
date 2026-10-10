export const JURY_ACTIVE_ORG_COOKIE = 'jury_active_org';

export function activeOrganizationCookie(tenantId: string): {
  name: string;
  value: string;
  options: { httpOnly: true; sameSite: 'lax'; path: string; secure: boolean };
} {
  return {
    name: JURY_ACTIVE_ORG_COOKIE,
    value: tenantId,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    },
  };
}
