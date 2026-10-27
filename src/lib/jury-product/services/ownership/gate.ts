/**
 * I-072/I-073: ownership gate. Pure decision.
 * Exempt (never gated): GA4_VIEWER, no enforceFrom configured, connections created before enforceFrom
 * (existing connections such as ATOMY stay exempt with no deadline).
 */
export type OwnershipGateInput = {
  accessMethod: string;
  connectionCreatedAt: Date;
  enforceFrom: Date | null;
  verifiedNow: boolean;
};

export type OwnershipGateDecision = { allowed: true; exempt: boolean } | { allowed: false; reason: 'OWNERSHIP_REQUIRED' };

export function isOwnershipGateApplicable(input: Omit<OwnershipGateInput, 'verifiedNow'>): boolean {
  if (input.accessMethod === 'GA4_VIEWER') return false;
  if (!input.enforceFrom) return false;
  return input.connectionCreatedAt.getTime() >= input.enforceFrom.getTime();
}

export function ownershipGateDecision(input: OwnershipGateInput): OwnershipGateDecision {
  if (!isOwnershipGateApplicable(input)) return { allowed: true, exempt: true };
  return input.verifiedNow ? { allowed: true, exempt: false } : { allowed: false, reason: 'OWNERSHIP_REQUIRED' };
}
