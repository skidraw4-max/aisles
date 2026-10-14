import type { MembershipFailure } from './membership-policy';

/**
 * Minimal, fixed-field diagnostics for organization creation failures.
 * Logs only: stage, kind, an allowlisted Prisma code, an allowlisted decision reason,
 * and an allowlisted error class name. Never the message, stack, meta, cause, digest,
 * the raw error, or any user/organization identifier.
 */
export const ORGANIZATION_CREATE_FAILED_EVENT = '[jury-org] CREATE_FAILED';

export type OrganizationCreateStage = 'auth' | 'ensure_user' | 'create_org' | 'decision' | 'cookie';
export type OrganizationCreateErrorKind =
  | 'prisma_known'
  | 'prisma_other'
  | 'connection'
  | 'decision_rejected'
  | 'unknown';

export type OrganizationCreateDiagnostic = {
  stage: OrganizationCreateStage;
  kind: OrganizationCreateErrorKind;
  prismaCode: string | null;
  errorName: string | null;
  reason?: MembershipFailure;
};

export type OrganizationCreateLog = (event: string, detail: OrganizationCreateDiagnostic) => void;

const PRISMA_CODE = /^P\d{4}$/;

/**
 * Connection-class codes, as mapped from driver adapter error kinds in the installed
 * @prisma/client 7.6.0 runtime: DatabaseNotReachable P1001, SocketTimeout P1008,
 * TlsConnectionError P1011, ConnectionClosed P1017, TooManyConnections P2037.
 */
const CONNECTION_CODES: ReadonlySet<string> = new Set(['P1001', 'P1008', 'P1011', 'P1017', 'P2037']);

const PRISMA_ERROR_NAMES: ReadonlySet<string> = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
  'PrismaClientValidationError',
  'DriverAdapterError',
]);
const ERROR_NAMES: ReadonlySet<string> = new Set([...PRISMA_ERROR_NAMES, 'Error', 'TypeError']);

const DECISION_REASONS: ReadonlySet<string> = new Set<MembershipFailure>([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'LAST_OWNER',
  'ALREADY_HAS_MEMBERSHIP',
  'TARGET_NOT_IN_TENANT',
  'NAME_REQUIRED',
  'USER_NOT_FOUND',
  'STORE_UNAVAILABLE',
]);

/** Prisma error code, only when it is a well-formed P#### string; otherwise null. */
export function organizationCreatePrismaCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && PRISMA_CODE.test(code) ? code : null;
}

function allowlistedErrorName(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' && ERROR_NAMES.has(name) ? name : 'other';
}

/** Classifies a thrown error by structured code and class name only. */
export function organizationCreateErrorDiagnostic(
  stage: OrganizationCreateStage,
  error: unknown,
): OrganizationCreateDiagnostic {
  const prismaCode = organizationCreatePrismaCode(error);
  const errorName = allowlistedErrorName(error);
  let kind: OrganizationCreateErrorKind = 'unknown';
  if (prismaCode) kind = CONNECTION_CODES.has(prismaCode) ? 'connection' : 'prisma_known';
  else if (errorName && PRISMA_ERROR_NAMES.has(errorName)) kind = 'prisma_other';
  return { stage, kind, prismaCode, errorName };
}

/** A non-throwing rejected decision; reason is kept only if it is a known decision reason. */
export function organizationCreateDecisionDiagnostic(reason: unknown): OrganizationCreateDiagnostic {
  const detail: OrganizationCreateDiagnostic = {
    stage: 'decision',
    kind: 'decision_rejected',
    prismaCode: null,
    errorName: null,
  };
  if (typeof reason === 'string' && DECISION_REASONS.has(reason)) detail.reason = reason as MembershipFailure;
  return detail;
}

const defaultLog: OrganizationCreateLog = (event, detail) => console.error(event, detail);

export function logOrganizationCreateFailure(
  detail: OrganizationCreateDiagnostic,
  log: OrganizationCreateLog = defaultLog,
): void {
  const safe: OrganizationCreateDiagnostic = {
    stage: detail.stage,
    kind: detail.kind,
    prismaCode: detail.prismaCode,
    errorName: detail.errorName,
    ...(detail.reason ? { reason: detail.reason } : {}),
  };
  log(ORGANIZATION_CREATE_FAILED_EVENT, safe);
}
