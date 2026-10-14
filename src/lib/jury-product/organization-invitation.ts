import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { decideJuryMutation, type JuryActor } from './access';
import { JURY_EMAIL_RE } from './jury-signup';
import type { JuryMemberRole, JuryMembership } from './records';

export type OrganizationInvitationRecord = {
  id: string;
  tenantId: string;
  email: string;
  role: JuryMemberRole;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  invitedBy: string;
};

export const INVITE_ROLES = ['ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITATION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type InvitationFailure =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'MALFORMED'
  | 'EXPIRED'
  | 'ALREADY_USED'
  | 'EMAIL_MISMATCH'
  | 'EMAIL_UNVERIFIED'
  | 'ALREADY_HAS_MEMBERSHIP'
  | 'INVALID_ROLE'
  | 'INVALID_EMAIL';

export type InvitationStatus = 'PENDING' | 'EXPIRED' | 'ACCEPTED';

export type InvitationAuditEvent = {
  id: string;
  tenantId: string;
  timestamp: string;
  actorUserId: string;
  action: 'INVITATION_CREATED' | 'INVITATION_ACCEPTED';
  provenance: {
    invitationId: string;
    tenantId: string;
    email: string;
    role: JuryMemberRole;
  };
};

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInvitationToken(token) };
}

export function normalizeInvitationEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (!JURY_EMAIL_RE.test(value)) return null;
  return value;
}

export function invitationStatus(
  row: { usedAt: string | null; expiresAt: string },
  now: string,
): InvitationStatus {
  if (row.usedAt) return 'ACCEPTED';
  if (Date.parse(row.expiresAt) < Date.parse(now)) return 'EXPIRED';
  return 'PENDING';
}

export function invitationTokenMatches(tokenHash: string, presentedToken: string): boolean {
  if (!INVITATION_TOKEN_RE.test(presentedToken) || !/^[a-f0-9]{64}$/.test(tokenHash)) return false;
  const actual = Buffer.from(hashInvitationToken(presentedToken), 'hex');
  const expected = Buffer.from(tokenHash, 'hex');
  return timingSafeEqual(actual, expected);
}

export function invitationAudit(input: {
  id: string;
  action: InvitationAuditEvent['action'];
  invitation: Pick<OrganizationInvitationRecord, 'id' | 'tenantId' | 'email' | 'role'>;
  actorUserId: string;
  timestamp: string;
}): InvitationAuditEvent {
  return {
    id: input.id,
    tenantId: input.invitation.tenantId,
    timestamp: input.timestamp,
    actorUserId: input.actorUserId,
    action: input.action,
    provenance: {
      invitationId: input.invitation.id,
      tenantId: input.invitation.tenantId,
      email: input.invitation.email,
      role: input.invitation.role,
    },
  };
}

export function invitationMessage(reason: InvitationFailure | 'FAILED', kind: 'create' | 'accept' = 'accept'): string {
  switch (reason) {
    case 'NOT_FOUND':
      return 'Invitation not found';
    case 'MALFORMED':
      return 'Invalid invitation';
    case 'EXPIRED':
      return 'Invitation expired';
    case 'ALREADY_USED':
      return 'Invitation already used';
    case 'EMAIL_MISMATCH':
      return 'Email does not match';
    case 'EMAIL_UNVERIFIED':
      return 'Email verification required';
    case 'ALREADY_HAS_MEMBERSHIP':
      return 'Already a member';
    case 'FORBIDDEN':
      return 'Not authorized to invite';
    case 'INVALID_ROLE':
      return 'Invalid invitation';
    case 'INVALID_EMAIL':
      return 'Enter a valid email.';
    case 'UNAUTHENTICATED':
      return 'Sign in to continue.';
    default:
      return kind === 'create' ? 'Invitation creation failed' : 'Invalid invitation';
  }
}

function authorizeInvitation(input: {
  actor: JuryActor;
  email: string;
  role: JuryMemberRole;
}): { ok: true; email: string; role: InviteRole } | { ok: false; reason: InvitationFailure } {
  if (!input.actor.ok) {
    return { ok: false, reason: input.actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' };
  }
  const allowed = decideJuryMutation({
    actor: input.actor,
    action: 'membership.write',
    resourceTenantId: input.actor.tenantId,
  });
  if (!allowed.ok) return { ok: false, reason: 'FORBIDDEN' };
  if (!(INVITE_ROLES as readonly string[]).includes(input.role)) return { ok: false, reason: 'INVALID_ROLE' };
  const email = normalizeInvitationEmail(input.email);
  if (!email) return { ok: false, reason: 'INVALID_EMAIL' };
  return { ok: true, email, role: input.role as InviteRole };
}

export function planOrganizationInvitation(input: {
  actor: JuryActor;
  email: string;
  role: JuryMemberRole;
  now: string;
  ttlMs?: number;
  allocateId?: () => string;
  alreadyMember?: boolean;
  pendingInvitationIds?: readonly string[];
  /** Ignored. The invitation tenant is the actor's active organization. */
  requestedTenantId?: string | null;
  requestedUserId?: string | null;
}):
  | { ok: true; invitation: OrganizationInvitationRecord; token: string; expireInvitationIds: string[] }
  | { ok: false; reason: InvitationFailure } {
  void input.requestedTenantId;
  void input.requestedUserId;
  const authorized = authorizeInvitation(input);
  if (!authorized.ok) return authorized;
  if (input.alreadyMember) return { ok: false, reason: 'ALREADY_HAS_MEMBERSHIP' };
  if (!input.actor.ok) return { ok: false, reason: 'FORBIDDEN' };
  const { token, tokenHash } = createInvitationToken();
  const ttl = input.ttlMs ?? INVITATION_TTL_MS;
  return {
    ok: true,
    token,
    expireInvitationIds: [...(input.pendingInvitationIds ?? [])],
    invitation: {
      id: input.allocateId?.() ?? 'invitation',
      tenantId: input.actor.tenantId,
      email: authorized.email,
      role: authorized.role,
      tokenHash,
      expiresAt: new Date(Date.parse(input.now) + ttl).toISOString(),
      usedAt: null,
      invitedBy: input.actor.userId,
    },
  };
}

export function planInvitationAcceptance(input: {
  invitation: OrganizationInvitationRecord | null;
  presentedToken: string;
  userId: string | null;
  authenticatedEmail: string | null;
  existingMemberships: readonly JuryMembership[];
  now: string;
  emailVerified?: boolean;
  allocateId?: () => string;
  requestedTenantId?: string | null;
  requestedUserId?: string | null;
  requestedRole?: string | null;
}):
  | { ok: true; membership: JuryMembership; usedAt: string }
  | { ok: false; reason: InvitationFailure } {
  void input.requestedTenantId;
  void input.requestedUserId;
  void input.requestedRole;
  const invitation = input.invitation;
  if (!input.userId) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!INVITATION_TOKEN_RE.test(input.presentedToken)) return { ok: false, reason: 'MALFORMED' };
  if (!invitation || !invitationTokenMatches(invitation.tokenHash, input.presentedToken)) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (invitation.usedAt) return { ok: false, reason: 'ALREADY_USED' };
  if (Date.parse(invitation.expiresAt) <= Date.parse(input.now)) return { ok: false, reason: 'EXPIRED' };
  if (input.emailVerified === false) return { ok: false, reason: 'EMAIL_UNVERIFIED' };
  const email = normalizeInvitationEmail(input.authenticatedEmail ?? '') ?? '';
  if (!email || email !== invitation.email) return { ok: false, reason: 'EMAIL_MISMATCH' };
  if (input.existingMemberships.some((row) => row.tenantId === invitation.tenantId)) {
    return { ok: false, reason: 'ALREADY_HAS_MEMBERSHIP' };
  }
  if (!(INVITE_ROLES as readonly string[]).includes(invitation.role)) return { ok: false, reason: 'INVALID_ROLE' };
  return {
    ok: true,
    usedAt: input.now,
    membership: {
      id: input.allocateId?.() ?? `mem-${invitation.id}`,
      tenantId: invitation.tenantId,
      userId: input.userId,
      role: invitation.role,
      createdAt: input.now,
    },
  };
}

export type InvitationDb = {
  lockTenant(tenantId: string): Promise<void>;
  findUserIdByEmail(email: string): Promise<string | null>;
  userHasMembership(userId: string, tenantId: string): Promise<boolean>;
  listPendingInvitationIds(tenantId: string, email: string, now: string): Promise<string[]>;
  expireInvitation(id: string, expiresAt: string): Promise<void>;
  insertInvitation(row: OrganizationInvitationRecord): Promise<void>;
  appendAudit(event: InvitationAuditEvent): Promise<void>;
  lockInvitationByHash(tokenHash: string): Promise<OrganizationInvitationRecord | null>;
  listMemberships(userId: string): Promise<JuryMembership[]>;
  createMembership(row: JuryMembership): Promise<void>;
  markInvitationUsed(id: string, usedAt: string): Promise<void>;
};

export async function commitOrganizationInvitation(
  input: {
    actor: JuryActor;
    email: string;
    role: JuryMemberRole;
    now: string;
    allocateId?: () => string;
    allocateAuditId?: () => string;
    requestedTenantId?: string | null;
    requestedUserId?: string | null;
  },
  db: InvitationDb,
): Promise<
  | { ok: true; invitation: OrganizationInvitationRecord; token: string; audit: InvitationAuditEvent }
  | { ok: false; reason: InvitationFailure }
> {
  const authorized = authorizeInvitation(input);
  if (!authorized.ok) return authorized;
  if (!input.actor.ok) return { ok: false, reason: 'FORBIDDEN' };
  await db.lockTenant(input.actor.tenantId);
  const existingUserId = await db.findUserIdByEmail(authorized.email);
  const alreadyMember = existingUserId
    ? await db.userHasMembership(existingUserId, input.actor.tenantId)
    : false;
  const pendingInvitationIds = alreadyMember
    ? []
    : await db.listPendingInvitationIds(input.actor.tenantId, authorized.email, input.now);
  const planned = planOrganizationInvitation({
    ...input,
    email: authorized.email,
    role: authorized.role,
    alreadyMember,
    pendingInvitationIds,
  });
  if (!planned.ok) return planned;
  const retiredAt = new Date(Date.parse(input.now) - 1).toISOString();
  for (const id of planned.expireInvitationIds) await db.expireInvitation(id, retiredAt);
  await db.insertInvitation(planned.invitation);
  const audit = invitationAudit({
    id: input.allocateAuditId?.() ?? `audit-${planned.invitation.id}`,
    action: 'INVITATION_CREATED',
    invitation: planned.invitation,
    actorUserId: input.actor.userId,
    timestamp: input.now,
  });
  await db.appendAudit(audit);
  return { ok: true, invitation: planned.invitation, token: planned.token, audit };
}

export async function commitInvitationAcceptance(
  input: {
    presentedToken: string;
    userId: string | null;
    authenticatedEmail: string | null;
    emailVerified: boolean;
    now: string;
    allocateId?: () => string;
    allocateAuditId?: () => string;
    requestedTenantId?: string | null;
    requestedUserId?: string | null;
    requestedRole?: string | null;
  },
  db: InvitationDb,
): Promise<
  | { ok: true; membership: JuryMembership; usedAt: string; audit: InvitationAuditEvent }
  | { ok: false; reason: InvitationFailure }
> {
  if (!input.userId) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!input.emailVerified) return { ok: false, reason: 'EMAIL_UNVERIFIED' };
  if (!INVITATION_TOKEN_RE.test(input.presentedToken)) return { ok: false, reason: 'MALFORMED' };
  const invitation = await db.lockInvitationByHash(hashInvitationToken(input.presentedToken));
  const existingMemberships = await db.listMemberships(input.userId);
  const planned = planInvitationAcceptance({
    invitation,
    presentedToken: input.presentedToken,
    userId: input.userId,
    authenticatedEmail: input.authenticatedEmail,
    existingMemberships,
    now: input.now,
    emailVerified: true,
    allocateId: input.allocateId,
    requestedTenantId: input.requestedTenantId,
    requestedUserId: input.requestedUserId,
    requestedRole: input.requestedRole,
  });
  if (!planned.ok || !invitation) return planned.ok ? { ok: false, reason: 'NOT_FOUND' } : planned;
  await db.createMembership(planned.membership);
  await db.markInvitationUsed(invitation.id, planned.usedAt);
  const audit = invitationAudit({
    id: input.allocateAuditId?.() ?? `audit-${invitation.id}`,
    action: 'INVITATION_ACCEPTED',
    invitation,
    actorUserId: input.userId,
    timestamp: planned.usedAt,
  });
  await db.appendAudit(audit);
  return { ok: true, membership: planned.membership, usedAt: planned.usedAt, audit };
}
