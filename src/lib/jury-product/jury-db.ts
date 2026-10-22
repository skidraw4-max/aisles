/**
 * Jury Prisma access. Queries are scoped by the server-resolved tenant.
 * credentialRef is a pointer, never printed as a secret.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  planServiceTarget,
  runMockDiscovery,
  runScopeDecision,
  type DiscoveryTx,
} from './discovery';
import type { JuryConsoleCatalog } from './console-fixture';
import { matchRecentOwnedOrganization, ORGANIZATION_CREATE_RETRY_MS, planOwnedOrganization } from './organization-creation';
import { organizationsForUser, type JuryOrganizationOption } from './organization-switch';
import {
  commitMemberRemoval,
  commitMemberRoleChange,
  type MemberManagementDb,
} from './member-management';
import {
  commitInvitationAcceptance,
  commitOrganizationInvitation,
  hashInvitationToken,
  invitationStatus,
  INVITATION_TOKEN_RE,
  type InvitationDb,
  type OrganizationInvitationRecord,
} from './organization-invitation';
import {
  runMembershipCommand,
  type MembershipCommand,
  type MembershipDecision,
  type MembershipTx,
} from './membership-policy';
import {
  JURY_ACCESS_METHODS,
  JURY_AGENTS,
  JURY_APPROVALS,
  JURY_AVAILABILITIES,
  JURY_CLAIM_STRENGTHS,
  JURY_CONNECTION_STATUSES,
  JURY_CORE_CONTRACT_VERSION,
  JURY_DECISIONS,
  JURY_DISCOVERY_FEASIBILITIES,
  JURY_EVIDENCE_STRENGTHS,
  JURY_EXECUTION_STATUSES,
  JURY_GATE_RESULTS,
  JURY_MEMBER_ROLES,
  JURY_METRIC_UNITS,
  JURY_PRODUCT_DATA_ROOT,
  JURY_REVIEW_STATUSES,
  JURY_REVIEW_TYPES,
  JURY_RISK_FLAGS,
  JURY_SCOPE_STATUSES,
  JURY_SOURCE_SYSTEMS,
  JURY_STOP_REASONS,
  JURY_TASK_STATUSES,
  type JuryAccessGrant,
  type JuryAccessMethod,
  type JuryAccessScope,
  type JuryAgentExecution,
  type JuryAgentKind,
  type JuryAuditEvent,
  type JuryChangeGateResult,
  type JuryDiscoveryResult,
  type JuryEvidence,
  type JuryEvidenceStrength,
  type JuryFinalSurface,
  type JuryImprovementTask,
  type JuryLoopGuardPolicy,
  type JuryMemberRole,
  type JuryMembership,
  type JuryNormalizedMetric,
  type JuryReReviewResult,
  type JuryReviewRequest,
  type JuryReviewResult,
  type JuryReviewStatus,
  type JuryRiskFlag,
  type JuryServiceConnection,
} from './records';

const STORE_CODES = new Set(['P2021', 'P2022', 'P1000', 'P1001', 'P1003', 'P1017']);

export function isJuryStoreUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  if (STORE_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : '';
  return message.includes('does not exist') || message.includes('DATABASE_URL is not set');
}

function iso(value: Date): string {
  return value.toISOString();
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value;
}

function asEnumArray<T extends string>(values: readonly T[], value: unknown): T[] | null {
  const raw = asStringArray(value);
  if (!raw) return null;
  const parsed = raw.map((item) => oneOf(values, item));
  if (parsed.some((item) => item === null)) return null;
  return parsed as T[];
}

function asPolicy(value: unknown): JuryLoopGuardPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const read = (key: string): number | null | undefined => {
    const item = row[key];
    if (item === null) return null;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    return undefined;
  };
  const maxIterations = read('maxIterations');
  const maxRuntimeMs = read('maxRuntimeMs');
  const maxCostUsd = read('maxCostUsd');
  if (maxIterations === undefined || maxRuntimeMs === undefined || maxCostUsd === undefined) return null;
  return { maxIterations, maxRuntimeMs, maxCostUsd };
}

function asFinalSurface(value: unknown): JuryFinalSurface | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const lists = ['topProblems', 'dimensionEvidence', 'supportedClaims', 'partiallySupportedClaims', 'hypotheses'] as const;
  const parsed: Partial<Record<(typeof lists)[number], string[]>> = {};
  for (const key of lists) {
    const items = asStringArray(row[key]);
    if (!items) return null;
    parsed[key] = items;
  }
  if (typeof row.statusSummary !== 'string' || typeof row.expectedUserEffect !== 'string' || typeof row.risk !== 'string') {
    return null;
  }
  return {
    statusSummary: row.statusSummary,
    expectedUserEffect: row.expectedUserEffect,
    risk: row.risk,
    topProblems: parsed.topProblems!,
    dimensionEvidence: parsed.dimensionEvidence!,
    supportedClaims: parsed.supportedClaims!,
    partiallySupportedClaims: parsed.partiallySupportedClaims!,
    hypotheses: parsed.hypotheses!,
  };
}

function asGrants(value: unknown): JuryAccessGrant[] | null {
  if (!Array.isArray(value)) return null;
  const grants: JuryAccessGrant[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (typeof row.resource !== 'string' || row.mode !== 'READ') return null;
    grants.push({ resource: row.resource, mode: 'READ' });
  }
  return grants;
}

function asProposed(value: unknown): Array<{ metric: string; reason: string }> | null {
  if (!Array.isArray(value)) return null;
  const rows: Array<{ metric: string; reason: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (typeof row.metric !== 'string' || typeof row.reason !== 'string') return null;
    rows.push({ metric: row.metric, reason: row.reason });
  }
  return rows;
}

function optionalRecords<T>(value: unknown, map: (row: Record<string, unknown>) => T | null): T[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) return undefined;
  const rows: T[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const mapped = map(item as Record<string, unknown>);
    if (!mapped) return undefined;
    rows.push(mapped);
  }
  return rows;
}

function toMembership(row: {
  id: string;
  tenantId: string;
  userId: string;
  role: string;
  createdAt: Date;
}): JuryMembership | null {
  const role = oneOf(JURY_MEMBER_ROLES, row.role);
  if (!role) return null;
  return { id: row.id, tenantId: row.tenantId, userId: row.userId, role, createdAt: iso(row.createdAt) };
}

export async function listOrganizationsForUser(userId: string): Promise<JuryOrganizationOption[]> {
  const rows = await prisma.juryMembership.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      tenantId: true,
      userId: true,
      role: true,
      createdAt: true,
      tenant: { select: { id: true, name: true } },
    },
  });
  return organizationsForUser({
    userId,
    memberships: rows.flatMap((row) => {
      const role = oneOf(JURY_MEMBER_ROLES, row.role);
      return role ? [{ tenantId: row.tenantId, userId: row.userId, role, createdAt: iso(row.createdAt) }] : [];
    }),
    tenants: rows.map((row) => ({ id: row.tenant.id, name: row.tenant.name })),
  });
}

export async function listMembershipsForUser(userId: string): Promise<JuryMembership[]> {
  const rows = await prisma.juryMembership.findMany({ where: { userId } });
  return rows.flatMap((row) => {
    const mapped = toMembership(row);
    return mapped ? [mapped] : [];
  });
}

function invitationDb(tx: Prisma.TransactionClient): InvitationDb {
  return {
    async lockTenant(tenantId) {
      await tx.$queryRaw`SELECT id FROM "JuryTenant" WHERE id = ${tenantId} FOR UPDATE`;
    },
    async findUserIdByEmail(email) {
      const rows = await tx.user.findMany({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, email: true },
      });
      return rows.find((row) => row.email.trim().toLowerCase() === email)?.id ?? null;
    },
    async userHasMembership(userId, tenantId) {
      const row = await tx.juryMembership.findFirst({ where: { userId, tenantId }, select: { id: true } });
      return Boolean(row);
    },
    async listPendingInvitationIds(tenantId, email, now) {
      const rows = await tx.organizationInvitation.findMany({
        where: { tenantId, email, usedAt: null, expiresAt: { gt: new Date(now) } },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    async expireInvitation(id, expiresAt) {
      await tx.organizationInvitation.update({ where: { id }, data: { expiresAt: new Date(expiresAt) } });
    },
    async insertInvitation(row) {
      await tx.organizationInvitation.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          email: row.email,
          role: row.role,
          tokenHash: row.tokenHash,
          expiresAt: new Date(row.expiresAt),
          invitedBy: row.invitedBy,
        },
      });
    },
    async appendAudit(event) {
      await tx.juryAuditEvent.create({
        data: {
          id: event.id,
          tenantId: event.tenantId,
          timestamp: new Date(event.timestamp),
          actor: event.actorUserId,
          action: event.action,
          provenance: event.provenance,
        },
      });
    },
    async lockInvitationByHash(tokenHash) {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        tenantId: string;
        email: string;
        role: string;
        tokenHash: string;
        expiresAt: Date;
        usedAt: Date | null;
        invitedBy: string;
      }>>`
        SELECT id, "tenantId", email, role::text AS role, "tokenHash", "expiresAt", "usedAt", "invitedBy"
        FROM "OrganizationInvitation"
        WHERE "tokenHash" = ${tokenHash}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) return null;
      const role = oneOf(JURY_MEMBER_ROLES, row.role);
      if (!role) return null;
      const invitation: OrganizationInvitationRecord = {
        id: row.id,
        tenantId: row.tenantId,
        email: row.email.trim().toLowerCase(),
        role,
        tokenHash: row.tokenHash,
        expiresAt: iso(row.expiresAt),
        usedAt: row.usedAt ? iso(row.usedAt) : null,
        invitedBy: row.invitedBy,
      };
      return invitation;
    },
    async listMemberships(userId) {
      const rows = await tx.juryMembership.findMany({ where: { userId } });
      return rows.flatMap((row) => {
        const mapped = toMembership(row);
        return mapped ? [mapped] : [];
      });
    },
    async createMembership(row) {
      await tx.juryMembership.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          userId: row.userId,
          role: row.role,
          createdAt: new Date(row.createdAt),
        },
      });
    },
    async markInvitationUsed(id, usedAt) {
      await tx.organizationInvitation.update({ where: { id }, data: { usedAt: new Date(usedAt) } });
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

export async function createOrganizationInvitationRecord(
  input: Parameters<typeof commitOrganizationInvitation>[0],
): Promise<Awaited<ReturnType<typeof commitOrganizationInvitation>>> {
  return prisma.$transaction((tx) => commitOrganizationInvitation(input, invitationDb(tx)));
}

export async function acceptOrganizationInvitationRecord(
  input: Parameters<typeof commitInvitationAcceptance>[0],
): Promise<Awaited<ReturnType<typeof commitInvitationAcceptance>>> {
  try {
    return await prisma.$transaction((tx) => commitInvitationAcceptance(input, invitationDb(tx)));
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'ALREADY_HAS_MEMBERSHIP' };
    throw error;
  }
}

export async function listTenantInvitations(tenantId: string, now = new Date().toISOString()): Promise<Array<{
  id: string;
  email: string;
  role: JuryMembership['role'];
  status: ReturnType<typeof invitationStatus>;
  expiresAt: string;
  createdAt: string;
}>> {
  const rows = await prisma.organizationInvitation.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      tenantId: true,
      email: true,
      role: true,
      expiresAt: true,
      usedAt: true,
      createdAt: true,
    },
  });
  return rows.flatMap((row) => {
    if (row.tenantId !== tenantId) return [];
    const role = oneOf(JURY_MEMBER_ROLES, row.role);
    if (!role) return [];
    const expiresAt = iso(row.expiresAt);
    const usedAt = row.usedAt ? iso(row.usedAt) : null;
    return [{
      id: row.id,
      email: row.email,
      role,
      status: invitationStatus({ usedAt, expiresAt }, now),
      expiresAt,
      createdAt: iso(row.createdAt),
    }];
  });
}

export async function readInvitationPreview(token: string): Promise<
  | { ok: false; reason: 'MALFORMED' | 'NOT_FOUND' }
  | {
      ok: true;
      invitation: {
        id: string;
        tenantId: string;
        tenantName: string;
        email: string;
        role: JuryMembership['role'];
        expiresAt: string;
        usedAt: string | null;
        status: ReturnType<typeof invitationStatus>;
      };
    }
> {
  if (!INVITATION_TOKEN_RE.test(token)) return { ok: false, reason: 'MALFORMED' };
  const row = await prisma.organizationInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: {
      id: true,
      tenantId: true,
      email: true,
      role: true,
      expiresAt: true,
      usedAt: true,
      tenant: { select: { name: true } },
    },
  });
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  const role = oneOf(JURY_MEMBER_ROLES, row.role);
  if (!role) return { ok: false, reason: 'NOT_FOUND' };
  const now = new Date().toISOString();
  const expiresAt = iso(row.expiresAt);
  const usedAt = row.usedAt ? iso(row.usedAt) : null;
  return {
    ok: true,
    invitation: {
      id: row.id,
      tenantId: row.tenantId,
      tenantName: row.tenant.name,
      email: row.email,
      role,
      expiresAt,
      usedAt,
      status: invitationStatus({ usedAt, expiresAt }, now),
    },
  };
}

function memberDb(tx: Prisma.TransactionClient): MemberManagementDb {
  return {
    async lockTenantMemberships(tenantId) {
      const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string; userId: string; role: string; createdAt: Date }>>`
        SELECT id, "tenantId", "userId", role::text AS role, "createdAt"
        FROM "JuryMembership"
        WHERE "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      return rows.flatMap((row) => {
        const mapped = toMembership(row);
        return mapped && mapped.tenantId === tenantId ? [mapped] : [];
      });
    },
    async updateRole(id, role) {
      await tx.juryMembership.update({ where: { id }, data: { role } });
    },
    async deleteMembership(id) {
      await tx.juryMembership.delete({ where: { id } });
    },
    async appendAudit(event) {
      await tx.juryAuditEvent.create({
        data: {
          id: event.id,
          tenantId: event.tenantId,
          timestamp: new Date(event.timestamp),
          actor: event.actorUserId,
          action: event.action,
          provenance: event.provenance,
        },
      });
    },
  };
}

export type OrganizationMemberRow = {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: JuryMembership['role'];
  joinedAt: string;
};

export async function listOrganizationMembers(tenantId: string): Promise<OrganizationMemberRow[]> {
  const rows = await prisma.juryMembership.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      tenantId: true,
      userId: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, email: true, username: true } },
    },
  });
  return rows.flatMap((row) => {
    if (row.tenantId !== tenantId || row.user.id !== row.userId) return [];
    const role = oneOf(JURY_MEMBER_ROLES, row.role);
    if (!role) return [];
    const displayName = row.user.username.trim();
    return [{
      membershipId: row.id,
      userId: row.userId,
      email: row.user.email,
      displayName: displayName ? displayName : null,
      role,
      joinedAt: iso(row.createdAt),
    }];
  });
}

export async function changeOrganizationMemberRole(
  input: Parameters<typeof commitMemberRoleChange>[0],
): Promise<Awaited<ReturnType<typeof commitMemberRoleChange>>> {
  return prisma.$transaction((tx) => commitMemberRoleChange(input, memberDb(tx)));
}

export async function removeOrganizationMember(
  input: Parameters<typeof commitMemberRemoval>[0],
): Promise<Awaited<ReturnType<typeof commitMemberRemoval>>> {
  const { removeOrganizationMemberWithServiceCleanup } = await import('./member-service-cleanup-db');
  const removed = await removeOrganizationMemberWithServiceCleanup(input);
  if (!removed.ok) return removed;
  return { ok: true, audit: removed.audit };
}

export async function listMembershipsForTenant(tenantId: string): Promise<JuryMembership[]> {
  const rows = await prisma.juryMembership.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.flatMap((row) => {
    const mapped = toMembership(row);
    return mapped && mapped.tenantId === tenantId ? [mapped] : [];
  });
}

export async function findResourceTenant(actorTenantId: string, resourceId: string): Promise<string | null> {
  if (!resourceId) return null;
  const where = { id: resourceId, tenantId: actorTenantId };
  const select = { tenantId: true } as const;
  const found = (
    await Promise.all([
      prisma.juryServiceConnection.findFirst({ where, select }),
      prisma.juryDiscoveryResult.findFirst({ where, select }),
      prisma.juryAccessScope.findFirst({ where, select }),
      prisma.juryEvidence.findFirst({ where, select }),
      prisma.juryReviewRequest.findFirst({ where, select }),
      prisma.juryReviewResult.findFirst({ where, select }),
      prisma.juryImprovementTask.findFirst({ where, select }),
      prisma.juryAgentExecution.findFirst({ where, select }),
      prisma.juryChangeGateResult.findFirst({ where, select }),
      prisma.juryReReviewResult.findFirst({ where, select }),
      prisma.juryNormalizedMetric.findFirst({ where, select }),
      prisma.juryAuditEvent.findFirst({ where, select }),
    ])
  ).find((row) => row !== null);
  return found?.tenantId === actorTenantId ? found.tenantId : null;
}

export async function loadJuryCatalog(tenantId: string): Promise<JuryConsoleCatalog> {
  const where = { tenantId };
  const [connections, scopes, discoveries, metrics, evidence, requests, results, tasks, executions, gates, reReviews, audit] =
    await Promise.all([
      prisma.juryServiceConnection.findMany({ where }),
      prisma.juryAccessScope.findMany({ where }),
      prisma.juryDiscoveryResult.findMany({ where }),
      prisma.juryNormalizedMetric.findMany({ where }),
      prisma.juryEvidence.findMany({ where }),
      prisma.juryReviewRequest.findMany({ where }),
      prisma.juryReviewResult.findMany({ where }),
      prisma.juryImprovementTask.findMany({ where }),
      prisma.juryAgentExecution.findMany({ where }),
      prisma.juryChangeGateResult.findMany({ where }),
      prisma.juryReReviewResult.findMany({ where }),
      prisma.juryAuditEvent.findMany({ where, orderBy: { timestamp: 'desc' } }),
    ]);

  const mappedTasks = tasks.flatMap((row) => {
    const status = oneOf(JURY_TASK_STATUSES, row.status);
    const criteria = asStringArray(row.acceptanceCriteria);
    const loopPolicy = asPolicy(row.loopPolicy);
    const stopReason = row.stopReason == null ? undefined : oneOf(JURY_STOP_REASONS, row.stopReason);
    if (!status || !criteria || !loopPolicy || (row.stopReason != null && !stopReason)) return [];
    if (row.tenantId !== tenantId) return [];
    const task: JuryImprovementTask = {
      id: row.id,
      tenantId: row.tenantId,
      reviewResultId: row.reviewResultId,
      diagnosis: row.diagnosis,
      acceptanceCriteria: criteria,
      status,
      loopIndex: row.loopIndex,
      loopPolicy,
      ...(row.parentTaskId ? { parentTaskId: row.parentTaskId } : {}),
      ...(stopReason ? { stopReason } : {}),
      ...(row.taskType === 'VERIFICATION' || row.taskType === 'REWORD' ? { taskType: row.taskType } : {}),
      ...(row.createdAt ? { createdAt: iso(row.createdAt) } : {}),
    };
    return [task];
  });

  return {
    connections: connections.flatMap((row) => {
      const accessMethod = oneOf(JURY_ACCESS_METHODS, row.accessMethod);
      const status = oneOf(JURY_CONNECTION_STATUSES, row.status);
      if (!accessMethod || !status || row.tenantId !== tenantId) return [];
      const mapped: JuryServiceConnection = {
        id: row.id,
        tenantId: row.tenantId,
        serviceKey: row.serviceKey,
        displayName: row.displayName,
        accessMethod,
        status,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
        ...(row.credentialRef ? { credentialRef: row.credentialRef } : {}),
        ...(row.createdByUserId ? { createdByUserId: row.createdByUserId } : {}),
      };
      return [mapped];
    }),
    scopes: scopes.flatMap((row) => {
      const status = oneOf(JURY_SCOPE_STATUSES, row.status);
      const grants = asGrants(row.grants);
      if (!status || !grants || row.tenantId !== tenantId) return [];
      const mapped: JuryAccessScope = {
        id: row.id,
        tenantId: row.tenantId,
        connectionId: row.connectionId,
        status,
        grants,
        ...(row.approvedByUserId ? { approvedByUserId: row.approvedByUserId } : {}),
        ...(row.approvedAt ? { approvedAt: iso(row.approvedAt) } : {}),
        ...(row.expiresAt ? { expiresAt: iso(row.expiresAt) } : {}),
      };
      return [mapped];
    }),
    discoveries: discoveries.flatMap((row) => {
      const feasibility = oneOf(JURY_DISCOVERY_FEASIBILITIES, row.feasibility);
      const approval = oneOf(JURY_APPROVALS, row.approval);
      const surfaces = asEnumArray(['FRONTEND', 'ADMIN', 'BO', 'API'] as const, row.surfaces);
      const menus = asStringArray(row.menus);
      const dataSources = asEnumArray(['API', 'SCREEN', 'FILE', 'STATS'] as const, row.dataSources);
      const proposedMetrics = asProposed(row.proposedMetrics);
      if (!feasibility || !approval || !surfaces || !menus || !dataSources || !proposedMetrics || row.tenantId !== tenantId) {
        return [];
      }
      const mapped: JuryDiscoveryResult = {
        id: row.id,
        tenantId: row.tenantId,
        connectionId: row.connectionId,
        exploredAt: iso(row.exploredAt),
        surfaces,
        menus,
        dataSources,
        feasibility,
        proposedMetrics,
        approval,
        ...(row.uiNotes ? { uiNotes: row.uiNotes } : {}),
      };
      return [mapped];
    }),
    metrics: metrics.flatMap((row) => {
      const unit = oneOf(JURY_METRIC_UNITS, row.unit);
      const sourceSystem = oneOf(JURY_SOURCE_SYSTEMS, row.sourceSystem);
      const availability = oneOf(JURY_AVAILABILITIES, row.availability);
      if (!unit || !sourceSystem || !availability || row.tenantId !== tenantId) return [];
      const mapped: JuryNormalizedMetric = {
        id: row.id,
        tenantId: row.tenantId,
        connectionId: row.connectionId,
        metric: row.metric,
        value: availability === 'AVAILABLE' ? row.value : null,
        unit,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        timezone: row.timezone,
        sourceSystem,
        sourceRef: row.sourceRef,
        collectedAt: iso(row.collectedAt),
        availability,
        rawPayloadRef: row.rawPayloadRef,
        adapterKey: row.adapterKey,
        adapterVersion: row.adapterVersion,
        ruleId: row.ruleId,
        ...(row.evidenceId ? { evidenceId: row.evidenceId } : {}),
        ...(row.rawValueText ? { rawValueText: row.rawValueText } : {}),
      };
      return [mapped];
    }),
    evidence: evidence.flatMap((row) => {
      const metricIds = asStringArray(row.metricIds);
      if (!metricIds || row.tenantId !== tenantId) return [];
      const apiEvidence = optionalRecords(row.apiEvidence, (item) => {
        if (typeof item.endpoint !== 'string' || typeof item.payloadRef !== 'string' || typeof item.requestedAt !== 'string') {
          return null;
        }
        return { endpoint: item.endpoint, payloadRef: item.payloadRef, requestedAt: item.requestedAt };
      });
      const uiEvidence = optionalRecords(row.uiEvidence, (item) => {
        if (typeof item.url !== 'string') return null;
        return {
          url: item.url,
          ...(typeof item.screenshotRef === 'string' ? { screenshotRef: item.screenshotRef } : {}),
          ...(typeof item.domRef === 'string' ? { domRef: item.domRef } : {}),
          ...(typeof item.visibleText === 'string' ? { visibleText: item.visibleText } : {}),
        };
      });
      const documentEvidence = optionalRecords(row.documentEvidence, (item) => {
        if (typeof item.fileName !== 'string' || typeof item.source !== 'string') return null;
        return {
          fileName: item.fileName,
          source: item.source,
          ...(typeof item.section === 'string' ? { section: item.section } : {}),
        };
      });
      if (row.apiEvidence != null && !apiEvidence) return [];
      if (row.uiEvidence != null && !uiEvidence) return [];
      if (row.documentEvidence != null && !documentEvidence) return [];
      const mapped: JuryEvidence = {
        id: row.id,
        tenantId: row.tenantId,
        connectionId: row.connectionId,
        purpose: row.purpose,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        timezone: row.timezone,
        metricIds,
        adapterKey: row.adapterKey,
        collectedAt: iso(row.collectedAt),
        ...(apiEvidence ? { apiEvidence } : {}),
        ...(uiEvidence ? { uiEvidence } : {}),
        ...(documentEvidence ? { documentEvidence } : {}),
        ...(row.contentHash ? { contentHash: row.contentHash } : {}),
        piiExcluded: row.piiExcluded,
        readOnly: row.readOnly,
      };
      return [mapped];
    }),
    requests: requests.flatMap((row): JuryReviewRequest[] => {
      const reviewType = oneOf(JURY_REVIEW_TYPES, row.reviewType);
      const mode = row.mode === 'AISLE_SELF' || row.mode === 'EXTERNAL_SERVICE' ? row.mode : null;
      const status = oneOf(JURY_REVIEW_STATUSES, row.status);
      if (!reviewType || !mode || !status || row.coreRootDir !== JURY_PRODUCT_DATA_ROOT || row.tenantId !== tenantId) {
        return [];
      }
      const base = {
        id: row.id,
        tenantId: row.tenantId,
        connectionId: row.connectionId,
        evidenceId: row.evidenceId,
        mode,
        status: status as JuryReviewStatus,
        coreRootDir: JURY_PRODUCT_DATA_ROOT,
        ...(row.requestedByUserId ? { requestedByUserId: row.requestedByUserId } : {}),
      };
      if (reviewType === 'CLAIM_VALIDATION') {
        if (!row.claim || row.claim.trim().length === 0) return [];
        const mapped: JuryReviewRequest = {
          ...base,
          reviewType,
          claim: row.claim,
          coreRootDir: JURY_PRODUCT_DATA_ROOT,
        };
        return [mapped];
      }
      const mapped: JuryReviewRequest = {
        ...base,
        reviewType,
        coreRootDir: JURY_PRODUCT_DATA_ROOT,
        ...(row.claim ? { claim: row.claim } : {}),
      };
      return [mapped];
    }),
    results: results.flatMap((row) => {
      const evidenceStrength = oneOf(JURY_EVIDENCE_STRENGTHS, row.evidenceStrength);
      const claimStrength = oneOf(JURY_CLAIM_STRENGTHS, row.claimStrength);
      const expectedDecision = oneOf(JURY_DECISIONS, row.expectedDecision);
      const finalSurface = asFinalSurface(row.finalSurface);
      if (
        !evidenceStrength ||
        !claimStrength ||
        !expectedDecision ||
        !finalSurface ||
        row.contractVersion !== JURY_CORE_CONTRACT_VERSION ||
        row.tenantId !== tenantId
      ) {
        return [];
      }
      const mapped: JuryReviewResult = {
        id: row.id,
        tenantId: row.tenantId,
        reviewRequestId: row.reviewRequestId,
        boardRunId: row.boardRunId,
        evidenceStrength: evidenceStrength as JuryEvidenceStrength,
        claimStrength,
        conflictDetected: row.conflictDetected,
        overclaimDetected: row.overclaimDetected,
        revisionRequired: row.revisionRequired,
        expectedDecision,
        finalSurface,
        contractVersion: JURY_CORE_CONTRACT_VERSION,
        completedAt: iso(row.completedAt),
      };
      return [mapped];
    }),
    tasks: mappedTasks,
    executions: executions.flatMap((row) => {
      const agent = oneOf(JURY_AGENTS, row.agent);
      const status = oneOf(JURY_EXECUTION_STATUSES, row.status);
      const allowedPaths = asStringArray(row.allowedPaths);
      const deniedPaths = asStringArray(row.deniedPaths);
      if (!agent || !status || !allowedPaths || !deniedPaths || row.tenantId !== tenantId) return [];
      const mapped: JuryAgentExecution = {
        id: row.id,
        tenantId: row.tenantId,
        taskId: row.taskId,
        agent: agent as JuryAgentKind,
        allowedPaths,
        deniedPaths,
        status,
        ...(row.startedAt ? { startedAt: iso(row.startedAt) } : {}),
        ...(row.finishedAt ? { finishedAt: iso(row.finishedAt) } : {}),
        ...(row.estimatedCostUsd != null ? { estimatedCostUsd: row.estimatedCostUsd } : {}),
      };
      return [mapped];
    }),
    gates: gates.flatMap((row) => {
      const gate = oneOf(JURY_GATE_RESULTS, row.gate);
      const changedFiles = asStringArray(row.changedFiles);
      const riskFlags = asEnumArray(JURY_RISK_FLAGS, row.riskFlags);
      if (!gate || !changedFiles || !riskFlags || row.tenantId !== tenantId) return [];
      const mapped: JuryChangeGateResult = {
        id: row.id,
        tenantId: row.tenantId,
        executionId: row.executionId,
        changedFiles,
        riskFlags: riskFlags as JuryRiskFlag[],
        testsPassed: row.testsPassed,
        gate,
      };
      return [mapped];
    }),
    reReviews: reReviews.flatMap((row) => {
      if (row.tenantId !== tenantId) return [];
      const mapped: JuryReReviewResult = {
        id: row.id,
        tenantId: row.tenantId,
        taskId: row.taskId,
        previousReviewResultId: row.previousReviewResultId,
        nextReviewResultId: row.nextReviewResultId,
        resolved: row.resolved,
        sameProblem: row.sameProblem,
        completedAt: iso(row.completedAt),
      };
      return [mapped];
    }),
    audit: audit.flatMap((row) => {
      if (row.tenantId !== tenantId) return [];
      const accessMethod = row.accessMethod == null ? undefined : oneOf(JURY_ACCESS_METHODS, row.accessMethod);
      const decision = row.decision == null ? undefined : oneOf(JURY_DECISIONS, row.decision);
      const agent = row.agent == null ? undefined : oneOf(JURY_AGENTS, row.agent);
      const changedFiles = row.changedFiles == null ? undefined : asStringArray(row.changedFiles);
      if (row.accessMethod != null && !accessMethod) return [];
      if (row.decision != null && !decision) return [];
      if (row.agent != null && !agent) return [];
      if (row.changedFiles != null && !changedFiles) return [];
      const mapped: JuryAuditEvent = {
        id: row.id,
        tenantId: row.tenantId,
        timestamp: iso(row.timestamp),
        actor: row.actor,
        action: row.action,
        ...(row.serviceKey ? { serviceKey: row.serviceKey } : {}),
        ...(accessMethod ? { accessMethod } : {}),
        ...(row.scopeId ? { scopeId: row.scopeId } : {}),
        ...(row.source ? { source: row.source } : {}),
        ...(row.evidenceId ? { evidenceId: row.evidenceId } : {}),
        ...(row.reviewId ? { reviewId: row.reviewId } : {}),
        ...(decision ? { decision } : {}),
        ...(row.improvementTaskId ? { improvementTaskId: row.improvementTaskId } : {}),
        ...(agent ? { agent } : {}),
        ...(changedFiles ? { changedFiles } : {}),
        ...(row.testResult ? { testResult: row.testResult } : {}),
        ...(row.reReviewResultId ? { reReviewResultId: row.reReviewResultId } : {}),
      };
      return [mapped];
    }),
    policies: mappedTasks[0]
      ? [{ tenantId, policy: mappedTasks[0].loopPolicy }]
      : [],
  };
}

function txAdapter(tx: Prisma.TransactionClient): MembershipTx {
  return {
    async userExists(userId) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      return Boolean(user);
    },
    async listTenant(tenantId) {
      const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string; userId: string; role: string; createdAt: Date }>>(
        Prisma.sql`SELECT id, "tenantId", "userId", role::text AS role, "createdAt" FROM "JuryMembership" WHERE "tenantId" = ${tenantId} FOR UPDATE`,
      );
      return rows.flatMap((row) => {
        const mapped = toMembership(row);
        return mapped ? [mapped] : [];
      });
    },
    async listUser(userId) {
      const rows = await tx.juryMembership.findMany({ where: { userId } });
      return rows.flatMap((row) => {
        const mapped = toMembership(row);
        return mapped ? [mapped] : [];
      });
    },
    async createTenant(input) {
      await tx.juryTenant.create({ data: { id: input.id, name: input.name } });
    },
    async createMembership(row) {
      await tx.juryMembership.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          userId: row.userId,
          role: row.role,
          createdAt: new Date(row.createdAt),
        },
      });
    },
    async updateRole(id, role) {
      await tx.juryMembership.update({ where: { id }, data: { role } });
    },
    async deleteMembership(id) {
      await tx.juryMembership.delete({ where: { id } });
    },
    async appendAudit(event) {
      await tx.juryAuditEvent.create({
        data: {
          id: event.id,
          tenantId: event.tenantId,
          timestamp: new Date(event.timestamp),
          actor: event.actorUserId,
          action: event.action,
        },
      });
    },
  };
}

export async function persistMembershipCommand(
  command: Parameters<typeof runMembershipCommand>[0],
): Promise<MembershipDecision> {
  return prisma.$transaction(async (tx) => runMembershipCommand(command, txAdapter(tx)));
}

/** Creates a JuryTenant and its first OWNER membership in one transaction. A repeat within the retry window reuses that tenant. */
export async function createOwnedOrganization(input: {
  userId: string;
  tenantName: string;
  now?: string;
}): Promise<MembershipDecision> {
  const now = input.now ?? new Date().toISOString();
  const planned = planOwnedOrganization({
    sessionUserId: input.userId,
    emailVerified: true,
    tenantName: input.tenantName,
    allocateId: newJuryId,
    now,
  });
  if (!planned.ok) return { ok: false, reason: planned.reason === 'NAME_REQUIRED' || planned.reason === 'NAME_TOO_LONG' ? 'NAME_REQUIRED' : 'UNAUTHENTICATED' };
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
    const since = new Date(Date.parse(now) - ORGANIZATION_CREATE_RETRY_MS);
    const recent = await tx.juryMembership.findMany({
      where: { userId: input.userId, role: 'OWNER', createdAt: { gte: since } },
      include: { tenant: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const reused = matchRecentOwnedOrganization({
      userId: input.userId,
      name: planned.tenantName,
      now,
      rows: recent.map((row) => ({
        tenantId: row.tenantId,
        userId: row.userId,
        role: row.role,
        tenantName: row.tenant.name,
        createdAt: row.createdAt.toISOString(),
      })),
    });
    if (reused) {
      const row = recent.find((item) => item.tenantId === reused);
      return {
        ok: true as const,
        kind: 'CREATE_TENANT' as const,
        tenantId: reused,
        tenantName: planned.tenantName,
        membership: {
          id: row?.id ?? planned.membership.id,
          tenantId: reused,
          userId: input.userId,
          role: 'OWNER' as const,
          createdAt: row?.createdAt.toISOString() ?? now,
        },
        audit: {
          tenantId: reused,
          actorUserId: input.userId,
          action: 'TENANT_CREATED' as const,
          targetUserId: input.userId,
          role: 'OWNER' as const,
        },
        membershipAudit: {
          tenantId: reused,
          actorUserId: input.userId,
          action: 'MEMBERSHIP_ADDED' as const,
          targetUserId: input.userId,
          role: 'OWNER' as const,
        },
      };
    }
    return runMembershipCommand({
      kind: 'CREATE_TENANT',
      userId: input.userId,
      tenantName: planned.tenantName,
      allocateId: () => planned.tenantId,
      now,
    }, txAdapter(tx));
  });
}

export function newJuryId(): string {
  return randomUUID();
}

export function bindDiscoveryTx(tx: Prisma.TransactionClient): DiscoveryTx {
  return discoveryTx(tx);
}

function discoveryTx(tx: Prisma.TransactionClient): DiscoveryTx {
  return {
    async findConnection(tenantId, connectionId) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryServiceConnection" WHERE id = ${connectionId} AND "tenantId" = ${tenantId} FOR UPDATE`,
      );
      if (locked.length === 0) return null;
      const row = await tx.juryServiceConnection.findFirst({ where: { id: connectionId, tenantId } });
      if (!row || row.tenantId !== tenantId) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        serviceKey: row.serviceKey,
        displayName: row.displayName,
        accessMethod: row.accessMethod,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        ...(row.createdByUserId ? { createdByUserId: row.createdByUserId } : {}),
      };
    },
    async insertDiscovery(row) {
      await tx.juryDiscoveryResult.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          connectionId: row.connectionId,
          exploredAt: new Date(row.exploredAt),
          surfaces: row.surfaces,
          menus: row.menus,
          dataSources: row.dataSources,
          feasibility: row.feasibility,
          proposedMetrics: row.proposedMetrics,
          approval: row.approval,
          uiNotes: row.uiNotes ?? null,
        },
      });
    },
    async insertScope(row) {
      await tx.juryAccessScope.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          connectionId: row.connectionId,
          status: row.status,
          grants: row.grants,
          approvedByUserId: row.approvedByUserId ?? null,
          approvedAt: row.approvedAt ? new Date(row.approvedAt) : null,
        },
      });
    },
    async updateConnectionStatus(id, status) {
      await tx.juryServiceConnection.update({ where: { id }, data: { status } });
    },
    async findScope(tenantId, scopeId) {
      const row = await tx.juryAccessScope.findFirst({ where: { id: scopeId, tenantId } });
      if (!row || row.tenantId !== tenantId) return null;
      const grants = Array.isArray(row.grants) ? row.grants : null;
      if (!grants) return null;
      const parsed = grants.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        if (typeof record.resource !== 'string' || record.mode !== 'READ') return [];
        return [{ resource: record.resource, mode: 'READ' as const }];
      });
      if (parsed.length !== grants.length) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        connectionId: row.connectionId,
        status: row.status,
        grants: parsed,
        ...(row.approvedByUserId ? { approvedByUserId: row.approvedByUserId } : {}),
        ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
      };
    },
    async findDiscovery(tenantId, connectionId) {
      const row = await tx.juryDiscoveryResult.findFirst({
        where: { tenantId, connectionId },
        orderBy: { exploredAt: 'desc' },
      });
      if (!row || row.tenantId !== tenantId) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        connectionId: row.connectionId,
        exploredAt: row.exploredAt.toISOString(),
        surfaces: row.surfaces as JuryDiscoveryResult['surfaces'],
        menus: row.menus as string[],
        dataSources: row.dataSources as JuryDiscoveryResult['dataSources'],
        feasibility: row.feasibility,
        proposedMetrics: row.proposedMetrics as JuryDiscoveryResult['proposedMetrics'],
        approval: row.approval,
        ...(row.uiNotes ? { uiNotes: row.uiNotes } : {}),
      };
    },
    async updateScope(id, status, approvedByUserId, approvedAt) {
      await tx.juryAccessScope.update({
        where: { id },
        data: {
          status,
          approvedByUserId: approvedByUserId ?? null,
          approvedAt: approvedAt ? new Date(approvedAt) : null,
        },
      });
    },
    async updateDiscoveryApproval(id, approval) {
      await tx.juryDiscoveryResult.update({ where: { id }, data: { approval } });
    },
    async appendAudit(event) {
      await tx.juryAuditEvent.create({
        data: {
          id: event.id,
          tenantId: event.tenantId,
          timestamp: new Date(event.timestamp),
          actor: event.actorUserId,
          action: event.action,
          scopeId: event.scopeId ?? null,
        },
      });
    },
  };
}

export async function persistServiceTarget(
  command: Parameters<typeof planServiceTarget>[0],
): Promise<ReturnType<typeof planServiceTarget>> {
  const decision = planServiceTarget(command);
  if (!decision.ok) return decision;
  await prisma.juryServiceConnection.create({
    data: {
      id: decision.connection.id,
      tenantId: decision.connection.tenantId,
      serviceKey: decision.connection.serviceKey,
      displayName: decision.connection.displayName,
      accessMethod: decision.connection.accessMethod,
      status: decision.connection.status,
      credentialRef: null,
      createdByUserId: decision.connection.createdByUserId ?? null,
      createdAt: new Date(decision.connection.createdAt),
      updatedAt: new Date(decision.connection.updatedAt),
    },
  });
  return decision;
}

export async function persistMockDiscovery(
  command: Parameters<typeof runMockDiscovery>[0],
): Promise<Awaited<ReturnType<typeof runMockDiscovery>>> {
  return prisma.$transaction(async (tx) => runMockDiscovery(command, discoveryTx(tx)));
}

export async function persistScopeDecision(
  command: Parameters<typeof runScopeDecision>[0],
): Promise<Awaited<ReturnType<typeof runScopeDecision>>> {
  return prisma.$transaction(async (tx) => runScopeDecision(command, discoveryTx(tx)));
}
