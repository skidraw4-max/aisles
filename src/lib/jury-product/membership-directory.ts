import fs from 'node:fs/promises';
import path from 'node:path';
import { JURY_MEMBER_ROLES, JURY_PRODUCT_DATA_ROOT, type JuryMemberRole, type JuryMembership } from './records';

function isRole(value: unknown): value is JuryMemberRole {
  return typeof value === 'string' && (JURY_MEMBER_ROLES as readonly string[]).includes(value);
}

function isMembership(value: unknown): value is JuryMembership {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<JuryMembership>;
  return (
    typeof row.id === 'string' &&
    typeof row.tenantId === 'string' &&
    row.tenantId.length > 0 &&
    typeof row.userId === 'string' &&
    row.userId.length > 0 &&
    isRole(row.role) &&
    typeof row.createdAt === 'string'
  );
}

/**
 * Verification-only reader for memberships.json.
 * Product sessions do not call this. Persistence is Prisma JuryMembership.
 */
export async function loadJuryMembershipDirectory(dir?: string): Promise<JuryMembership[]> {
  const root = dir ?? path.join(process.cwd(), JURY_PRODUCT_DATA_ROOT);
  try {
    const raw = await fs.readFile(path.join(root, 'memberships.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMembership);
  } catch {
    return [];
  }
}
