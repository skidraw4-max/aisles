/**
 * Provider boundary above the existing Jury connection.
 * Jury Core does not learn which external product a connection belongs to.
 *
 * Credential security rules:
 * 1. Raw credentials are not stored in Prisma.
 * 2. Raw credentials are not stored on JuryAuditEvent.
 * 3. Raw credentials are not stored on Evidence.
 * 4. Raw credentials are not stored on ReviewResult.
 * 5. Raw credentials are not stored on ImprovementTask.
 * 6. Raw credentials are not stored on AgentExecution provenance.
 * 7. Raw credentials are not rendered in the UI.
 * 8. Raw credentials are not written to application logs.
 * 9. Raw credentials are not included in error messages.
 */
import type { JuryAccessMethod, JuryAvailability, JuryConnectionStatus } from '../records';

export const SERVICE_PROVIDERS = ['MOCK', 'GITHUB'] as const;
export type ServiceProviderId = (typeof SERVICE_PROVIDERS)[number];

export const CONNECTION_METHODS = [
  'OAUTH',
  'API_KEY',
  'TOKEN',
  'READ_ONLY_ACCOUNT',
  'BROWSER_SESSION',
  'FILE_IMPORT',
] as const;
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number];

export const CREDENTIAL_STATUSES = [
  'UNCONFIGURED',
  'PENDING',
  'ACTIVE',
  'EXPIRED',
  'REVOKED',
  'ERROR',
] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export const CONNECTION_HEALTH = [
  'UNKNOWN',
  'HEALTHY',
  'DEGRADED',
  'EXPIRED',
  'REVOKED',
  'FAILED',
] as const;
export type ConnectionHealth = (typeof CONNECTION_HEALTH)[number];

export const PROVIDER_ERROR_CODES = [
  'UNSUPPORTED_PROVIDER',
  'CONNECTION_NOT_FOUND',
  'CONNECTION_UNAUTHORIZED',
  'CREDENTIAL_UNAVAILABLE',
  'CREDENTIAL_EXPIRED',
  'CREDENTIAL_REVOKED',
  'DISCOVERY_FAILED',
  'EVIDENCE_COLLECTION_FAILED',
  'PROVIDER_UNAVAILABLE',
  'SCOPE_DENIED',
  'READ_ACCESS_REQUIRED',
  'SECRET_REJECTED',
  'GITHUB_NOT_CONFIGURED',
  'GITHUB_UNAUTHORIZED',
  'GITHUB_FORBIDDEN',
  'GITHUB_NOT_FOUND',
  'GITHUB_RATE_LIMIT',
  'GITHUB_UNAVAILABLE',
  'GITHUB_STATE_INVALID',
  'GITHUB_INVALID_RESPONSE',
  'COLLECTION_LIMIT_EXCEEDED',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export const PROVIDER_AUDIT_ACTIONS = [
  'CONNECTION_CREATED',
  'CONNECTION_UPDATED',
  'CONNECTION_DISCONNECTED',
  'CREDENTIAL_CONNECTED',
  'CREDENTIAL_REVOKED',
  'DISCOVERY_STARTED',
  'DISCOVERY_COMPLETED',
  'DISCOVERY_FAILED',
] as const;
export type ProviderAuditAction = (typeof PROVIDER_AUDIT_ACTIONS)[number];

export type ProviderCapabilities = {
  discovery: boolean;
  evidence: boolean;
  canRead: boolean;
  canWrite: boolean;
  oauth: boolean;
  apiKey: boolean;
};

export type ServiceAccessScope = {
  resource: string;
  operation: 'read' | 'write';
  readonly: boolean;
};

export type CredentialReference = {
  provider: ServiceProviderId;
  tenantId: string;
  connectionId: string;
  referenceId: string | null;
  status: CredentialStatus;
  createdAt: string;
  expiresAt: string | null;
};

export type DiscoveryStatus = 'DISCOVERED' | 'PARTIAL' | 'FAILED' | 'UNSUPPORTED';

export type DiscoveryResult = {
  provider: ServiceProviderId;
  tenantId: string;
  connectionId: string;
  discoveredResources: string[];
  requestedScopes: ServiceAccessScope[];
  warnings: string[];
  status: DiscoveryStatus;
};

export type NormalizedMetric = {
  metric: string;
  value: number | null;
  availability: JuryAvailability;
};

export type NormalizedEvidence = {
  provider: ServiceProviderId;
  connectionId: string;
  readOnly: true;
  metrics: NormalizedMetric[];
};

export type ProviderError = {
  ok: false;
  code: ProviderErrorCode;
  message: string;
};

export type DiscoveryProvider = {
  discover(input: {
    actorTenantId: string;
    connectionId: string;
    tenantId: string;
  }): Promise<DiscoveryResult> | DiscoveryResult | ProviderError;
};

export type EvidenceProvider = {
  collect(input: {
    connectionId: string;
    credentialStatus: CredentialStatus;
    metrics: ReadonlyArray<{ metric: string; value: number | null; availability?: JuryAvailability }>;
  }): Promise<NormalizedEvidence> | { ok: true; evidence: NormalizedEvidence } | ProviderError;
};

export type DataNormalizer = (
  value: number | null | undefined,
  availability?: JuryAvailability,
) => { value: number | null; availability: JuryAvailability };

export type ServiceAdapter = {
  provider: ServiceProviderId;
  discover(input: {
    actorTenantId: string;
    connection: {
      id: string;
      tenantId: string;
      serviceKey: string;
      displayName: string;
      accessMethod: JuryAccessMethod;
      status: JuryConnectionStatus;
      createdAt: string;
      updatedAt: string;
    };
    now?: string;
  }): DiscoveryResult | ProviderError;
  collectEvidence(input: {
    connectionId: string;
    credentialStatus: CredentialStatus;
    writeRequested?: boolean;
    metrics: ReadonlyArray<{ metric: string; value: number | null; availability?: JuryAvailability }>;
  }): { ok: true; evidence: NormalizedEvidence } | ProviderError;
  health(input: {
    connectionStatus: JuryConnectionStatus | null;
    credentialStatus: CredentialStatus;
    hasDiscovery: boolean;
    hasEvidence: boolean;
  }): ConnectionHealth;
};

export type ServiceProviderDefinition = {
  provider: ServiceProviderId;
  displayName: string;
  capabilities: ProviderCapabilities;
  connectionMethods: readonly ConnectionMethod[];
  scopes: readonly ServiceAccessScope[];
  adapterFactory: () => ServiceAdapter;
};

const RAW_CREDENTIAL = /password|token|api[_-]?key|secret|credential|oauth/i;
const POINTER = /^secret-store\/([A-Za-z0-9._/-]+)$/;

export function isCredentialUsable(status: CredentialStatus): boolean {
  return status === 'ACTIVE';
}

export function mapConnectionMethod(method: JuryAccessMethod): ConnectionMethod {
  if (method === 'FILE_UPLOAD') return 'FILE_IMPORT';
  return method;
}

export function containsRawCredential(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') {
    const pointer = POINTER.exec(value);
    if (pointer) return RAW_CREDENTIAL.test(pointer[1] ?? '');
    return RAW_CREDENTIAL.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsRawCredential(item));
  if (typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => RAW_CREDENTIAL.test(key) || containsRawCredential(item));
  }
  return false;
}

const ERROR_MESSAGE: Record<ProviderErrorCode, string> = {
  UNSUPPORTED_PROVIDER: 'This service provider is not available.',
  CONNECTION_NOT_FOUND: 'Service connection was not found.',
  CONNECTION_UNAUTHORIZED: 'You cannot use this service connection.',
  CREDENTIAL_UNAVAILABLE: 'A usable credential reference is not available.',
  CREDENTIAL_EXPIRED: 'The credential reference is expired.',
  CREDENTIAL_REVOKED: 'The credential reference is revoked.',
  DISCOVERY_FAILED: 'Discovery did not complete.',
  EVIDENCE_COLLECTION_FAILED: 'Evidence could not be collected.',
  PROVIDER_UNAVAILABLE: 'The service provider is not available.',
  SCOPE_DENIED: 'The requested access scope was denied.',
  READ_ACCESS_REQUIRED: 'Read access is required.',
  SECRET_REJECTED: 'The request was rejected.',
  GITHUB_NOT_CONFIGURED: 'GitHub App configuration is not available.',
  GITHUB_UNAUTHORIZED: 'GitHub authentication failed.',
  GITHUB_FORBIDDEN: 'GitHub denied the requested read.',
  GITHUB_NOT_FOUND: 'The GitHub resource was not found.',
  GITHUB_RATE_LIMIT: 'GitHub is rate limiting requests.',
  GITHUB_UNAVAILABLE: 'GitHub did not complete the request.',
  GITHUB_STATE_INVALID: 'The GitHub connection request is not valid.',
  GITHUB_INVALID_RESPONSE: 'GitHub returned a response that could not be read.',
  COLLECTION_LIMIT_EXCEEDED: 'The read stopped because the collection limit was reached.',
};

export function providerError(code: ProviderErrorCode, detail?: string): ProviderError {
  void detail;
  return { ok: false, code, message: ERROR_MESSAGE[code] };
}

export const normalizeMeasuredValue: DataNormalizer = function normalizeMeasuredValue(
  value: number | null | undefined,
  availability?: JuryAvailability,
): { value: number | null; availability: JuryAvailability } {
  if (availability === 'AVAILABLE' && typeof value === 'number' && Number.isFinite(value)) {
    return { value, availability: 'AVAILABLE' };
  }
  if (value === 0) return { value: 0, availability: 'AVAILABLE' };
  return { value: null, availability: availability && availability !== 'AVAILABLE' ? availability : 'NOT_MEASURED' };
};
