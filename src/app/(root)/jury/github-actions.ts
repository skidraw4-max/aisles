'use server';

import { redirect } from 'next/navigation';
import { juryHref } from '@/lib/jury-product/jury-url';
import { getJuryActor } from '@/lib/jury-product/session';
import type { ProviderErrorCode } from '@/lib/jury-product/services/provider-types';
import { collectGithubRepositoryEvidence, startGithubRepositoryReview } from '@/lib/jury-product/services/github/product';
import {
  beginGithubConnect,
  disconnectGithubConnection,
  selectGithubRepository,
} from '@/lib/jury-product/services/github/store';

const RESULTS: Partial<Record<ProviderErrorCode, string>> = {
  GITHUB_NOT_CONFIGURED: 'not-configured',
  GITHUB_UNAUTHORIZED: 'unauthorized',
  GITHUB_FORBIDDEN: 'forbidden',
  GITHUB_NOT_FOUND: 'not-found',
  GITHUB_RATE_LIMIT: 'rate-limit',
  GITHUB_UNAVAILABLE: 'unavailable',
  GITHUB_STATE_INVALID: 'state-invalid',
  CONNECTION_NOT_FOUND: 'not-found',
  CONNECTION_UNAUTHORIZED: 'forbidden',
  COLLECTION_LIMIT_EXCEEDED: 'limit',
  GITHUB_INVALID_RESPONSE: 'unavailable',
  PROVIDER_UNAVAILABLE: 'unavailable',
  SECRET_REJECTED: 'unavailable',
  DISCOVERY_FAILED: 'unavailable',
  EVIDENCE_COLLECTION_FAILED: 'unavailable',
  SCOPE_DENIED: 'forbidden',
  READ_ACCESS_REQUIRED: 'forbidden',
};

function githubResult(code: string): string {
  if (code === 'connected' || code === 'selected' || code === 'disconnected' || code === 'collected' || code === 'partial' || code === 'reviewed' || code === 'in-progress' || code === 'evidence-failed' || code === 'review-failed' || code === 'review-exists') {
    return juryHref('/services/github', { result: code });
  }
  return juryHref('/services/github', { result: RESULTS[code as ProviderErrorCode] ?? 'unavailable' });
}

function ignoredIdentity(formData: FormData) {
  void formData.get('tenantId');
  void formData.get('organizationId');
  void formData.get('userId');
  void formData.get('role');
  void formData.get('permission');
  void formData.get('operation');
  void formData.get('readonly');
}

function actionCode(result: { ok: true } | { ok: false; code?: string; flow?: string }, success: string): string {
  if (result.ok) return success;
  if ('flow' in result && result.flow) return result.flow;
  return result.code ?? 'unavailable';
}

export async function startGithubConnect(formData: FormData): Promise<void> {
  ignoredIdentity(formData);
  const actor = await getJuryActor(null);
  const started = await beginGithubConnect({
    actor,
    clientTenantId: null,
    clientOrganizationId: null,
    clientUserId: null,
    clientRole: null,
    clientPermission: null,
  });
  if (!started.ok) redirect(githubResult(started.code));
  redirect(started.redirectUrl);
}

export async function chooseGithubRepository(formData: FormData): Promise<void> {
  ignoredIdentity(formData);
  const actor = await getJuryActor(null);
  const connectionId = formData.get('connectionId');
  const fullName = formData.get('fullName');
  const selected = await selectGithubRepository({
    actor,
    connectionId: typeof connectionId === 'string' ? connectionId : '',
    fullName: typeof fullName === 'string' ? fullName : '',
    clientTenantId: null,
    clientPermission: null,
  });
  redirect(githubResult(selected.ok ? 'selected' : selected.code));
}

export async function collectGithubEvidence(formData: FormData): Promise<void> {
  ignoredIdentity(formData);
  const actor = await getJuryActor(null);
  const connectionId = String(formData.get('connectionId') ?? '');
  const fullName = String(formData.get('fullName') ?? '');
  let code = 'unavailable';
  try {
    const collected = await collectGithubRepositoryEvidence({
      actor,
      connectionId,
      requestedFullName: fullName,
      clientTenantId: null,
      clientOrganizationId: null,
      clientUserId: null,
      clientRole: null,
      clientPermission: null,
    });
    code = actionCode(collected, collected.ok && collected.view.status === 'PARTIAL' ? 'partial' : 'collected');
  } catch {
    code = 'PROVIDER_UNAVAILABLE';
  }
  redirect(githubResult(code));
}

export async function reviewGithubEvidence(formData: FormData): Promise<void> {
  ignoredIdentity(formData);
  const actor = await getJuryActor(null);
  const connectionId = String(formData.get('connectionId') ?? '');
  let code = 'unavailable';
  try {
    const reviewed = await startGithubRepositoryReview({
      actor,
      connectionId,
      execute: async (pack) => {
        const { callFrozenReviewPipeline } = await import('@/lib/jury-product/review-core');
        const { createGeminiReviewBoardLlm } = await import('@/lib/ai-review-board');
        const { readGeminiApiKeyFromEnv } = await import('@/lib/gemini-prompt-analysis-engine');
        const { JURY_PRODUCT_DATA_ROOT } = await import('@/lib/jury-product/records');
        const key = readGeminiApiKeyFromEnv();
        if (!key.ok) throw new Error('REVIEW_NOT_EXECUTED');
        return callFrozenReviewPipeline({
          rootDir: JURY_PRODUCT_DATA_ROOT,
          evidence: pack,
          llm: createGeminiReviewBoardLlm(key.key),
        });
      },
    });
    code = actionCode(reviewed, 'reviewed');
  } catch {
    code = 'PROVIDER_UNAVAILABLE';
  }
  redirect(githubResult(code));
}

export async function disconnectGithub(formData: FormData): Promise<void> {
  ignoredIdentity(formData);
  const actor = await getJuryActor(null);
  const connectionId = formData.get('connectionId');
  const disconnected = await disconnectGithubConnection({
    actor,
    connectionId: typeof connectionId === 'string' ? connectionId : '',
    clientTenantId: null,
  });
  redirect(githubResult(disconnected.ok ? 'disconnected' : disconnected.code));
}
