/**
 * Canonical fingerprint of the EvidencePack passed to the frozen pipeline.
 * Object key order is ignored. Array order is kept, because the prompt keeps it.
 * generatedAt and analysisPeriod stay in the hash: formatEvidencePackForPrompt
 * sends the whole pack, including those fields, to the model.
 * undefined fields are omitted. null is kept, so null and 0 stay distinct.
 * The returned value is a hash. The pack itself is not included.
 */
import { createHash } from 'node:crypto';
import type { EvidencePack } from '@/lib/ai-review-board/types';

const REFRESH_SCOPE = 'github-refresh-review-v1';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries.map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

export function canonicalEvidencePack(pack: EvidencePack): string {
  return JSON.stringify(sortValue(pack));
}

export function evidencePackFingerprint(pack: EvidencePack): string {
  return createHash('sha256').update(canonicalEvidencePack(pack)).digest('hex');
}

function scoped(parts: readonly string[]): string {
  const body = parts.map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`).join('\n');
  return createHash('sha256').update(`${REFRESH_SCOPE}\n${body}`).digest('hex');
}

export function githubRefreshRequestId(tenantId: string, evidenceId: string, fingerprint: string): string {
  return scoped([tenantId, evidenceId, 'FULL_REVIEW', fingerprint]);
}
