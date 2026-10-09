/**
 * Pure GitHub review start plan.
 * Service permission, tenant, and organization role are not inputs.
 */
import type { JuryReviewStatus } from '../../records';

export type GithubReviewEvidenceStatus = 'COLLECTED' | 'PARTIAL' | 'FAILED';

export function planGithubReviewStart(input: {
  evidenceStatus: GithubReviewEvidenceStatus | null;
  reviewStatus: JuryReviewStatus | null;
}): { ok: true } | { ok: false; flow: 'evidence-failed' | 'in-progress' | 'review-failed' | 'review-exists' } {
  if (!input.evidenceStatus || input.evidenceStatus === 'FAILED') return { ok: false, flow: 'evidence-failed' };
  if (input.reviewStatus === 'QUEUED' || input.reviewStatus === 'RUNNING') return { ok: false, flow: 'in-progress' };
  if (input.reviewStatus === 'FAILED') return { ok: false, flow: 'review-failed' };
  if (input.reviewStatus === 'COMPLETED') return { ok: false, flow: 'review-exists' };
  return { ok: true };
}
