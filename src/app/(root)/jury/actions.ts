'use server';

import { redirect } from 'next/navigation';
import { isJuryAction, planJuryCommand } from '@/lib/jury-product/access';
import type { EvidencePack } from '@/lib/ai-review-board/types';
import { buildConsoleIntakeInput, consoleIntakeCode } from '@/lib/jury-product/console-evidence-intake';
import { JURY_MEMBER_ROLES, JURY_PRODUCT_DATA_ROOT } from '@/lib/jury-product/records';
import { runTenantReview, tenantReviewCode } from '@/lib/jury-product/tenant-review';
import { persistConsoleLoopStop } from '@/lib/jury-product/console-loop-operations-store';
import { catalogScopeCode, persistCatalogScope, persistCatalogScopeDecision } from '@/lib/jury-product/console-catalog-scope';
import { evaluateHumanChangeGate } from '@/lib/jury-product/human-change-gate';
import { evaluateHumanReReview } from '@/lib/jury-product/human-re-review';
import { persistReReviewImprovement } from '@/lib/jury-product/rereview-improvement-bridge';
import { evaluateReReviewChangeGate } from '@/lib/jury-product/rereview-change-gate';
import { evaluateSecondReReview } from '@/lib/jury-product/rereview-second-review';
import { persistSecondReReviewImprovement } from '@/lib/jury-product/rereview-second-improvement';
import { approveSecondImprovement } from '@/lib/jury-product/rereview-second-approval';
import { handoffSecondImprovement } from '@/lib/jury-product/rereview-second-handoff';
import { evaluateSecondChangeGate } from '@/lib/jury-product/rereview-second-change-gate';
import { evaluateLaterReReview } from '@/lib/jury-product/rereview-later-review';
import { persistLaterReReviewImprovement } from '@/lib/jury-product/rereview-later-improvement';
import { approveLaterImprovement } from '@/lib/jury-product/rereview-later-approval';
import { handoffLaterImprovement } from '@/lib/jury-product/rereview-later-handoff';
import { executeLaterAgentExecution } from '@/lib/jury-product/rereview-later-agent-execution';
import { evaluateLaterChangeGate } from '@/lib/jury-product/rereview-later-change-gate';
import { evaluateFollowingReReview } from '@/lib/jury-product/rereview-following-review';
import { executeReReviewAgentExecution } from '@/lib/jury-product/rereview-agent-execution';
import { approveReReviewAgent, persistReReviewAgentHandoff } from '@/lib/jury-product/rereview-agent-handoff';
import { evaluateProductChangeGate } from '@/lib/jury-product/product-change-gate';
import { runProductChangeGateReReview as startProductChangeGateReReview } from '@/lib/jury-product/product-change-gate-rereview';

import { executeProductAgentExecution } from '@/lib/jury-product/product-execution';
import { handoffProductImprovement } from '@/lib/jury-product/product-handoff';
import { persistHumanImprovement } from '@/lib/jury-product/human-improvement-bridge';
import { noteHumanNextAction } from '@/lib/jury-product/review-console';
import { persistTenantEvidenceIntake } from '@/lib/jury-product/tenant-evidence-intake-store';
import {
  findResourceTenant,
  isJuryStoreUnavailable,
  listMembershipsForUser,
  newJuryId,
  persistMembershipCommand,
  persistMockDiscovery,
  persistScopeDecision,
  persistServiceTarget,
} from '@/lib/jury-product/jury-db';
import { JURY_ACCESS_METHODS, type JuryAccessMethod, type JuryMemberRole } from '@/lib/jury-product/records';
import {
  runConnectedServiceEvidenceCollection,
  runConnectedServiceReview,
} from '@/lib/jury-product/connected-service-review';
import {
  persistOnboardingDiscovery,
  persistOnboardingScopeDecision,
  persistServiceOnboarding,
} from '@/lib/jury-product/service-onboarding';
import { getJuryActor } from '@/lib/jury-product/session';
import {
  guardAgentExecutionFeature,
  guardEvidenceFeature,
  guardImprovementFeature,
  guardReviewFeature,
  guardServiceFeature,
} from '@/lib/jury-product/service-feature-guard';
import { createClient } from '@/lib/supabase/server';

function safeReturnTo(value: FormDataEntryValue | null): string {
  const raw = typeof value === 'string' ? value : '';
  const path = raw.split('?')[0] ?? '';
  if ((path === '/jury' || path.startsWith('/jury/')) && !path.includes('\\') && !path.includes('://') && !path.includes('..')) {
    return path || '/jury';
  }
  return '/jury';
}

function isRole(value: string): value is JuryMemberRole {
  return (JURY_MEMBER_ROLES as readonly string[]).includes(value);
}

function isAccessMethod(value: string): value is JuryAccessMethod {
  return (JURY_ACCESS_METHODS as readonly string[]).includes(value);
}

export async function stopJuryAutoLoop(formData: FormData): Promise<void> {
  void formData.get('tenantId');
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/automation?result=${actor.reason}`);
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const decision = await persistConsoleLoopStop({
      userId: actor.userId,
      memberships,
      clientTenantId: null,
      now: new Date().toISOString(),
      command: String(formData.get('command') ?? ''),
    });
    const result = decision.ok ? (decision.changed ? 'LOOP_STOPPED' : 'LOOP_ALREADY_STOPPED') : decision.reason;
    redirect(`/jury/automation?result=${result}`);
  } catch (error) {
    if (isJuryStoreUnavailable(error)) redirect('/jury/automation?result=STORE_UNAVAILABLE');
    throw error;
  }
}

export async function submitJuryAction(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const actionName = String(formData.get('action') ?? '');
  const clientTenantId = String(formData.get('tenantId') ?? '');
  const resourceId = String(formData.get('resourceId') ?? '');
  const actor = await getJuryActor(clientTenantId);
  if (!isJuryAction(actionName)) {
    redirect(`${returnTo}?result=FORBIDDEN`);
  }
  let tenantForResource = '';
  try {
    if (resourceId) {
      tenantForResource = actor.ok ? ((await findResourceTenant(actor.tenantId, resourceId)) ?? '') : '';
    } else if (actor.ok) {
      tenantForResource = actor.tenantId;
    }
  } catch (error) {
    if (isJuryStoreUnavailable(error)) redirect(`${returnTo}?result=STORE_UNAVAILABLE`);
    throw error;
  }
  const planned = planJuryCommand({
    actor,
    action: actionName,
    resourceTenantId: tenantForResource,
    clientTenantId,
  });
  redirect(`${returnTo}?result=${planned.ok ? 'OK' : planned.reason}`);
}

export async function createJuryTenant(formData: FormData): Promise<void> {
  const tenantName = String(formData.get('tenantName') ?? '');
  const clientTenantId = String(formData.get('tenantId') ?? '');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  try {
    const decision = await persistMembershipCommand({
      kind: 'CREATE_TENANT',
      userId: user?.id ?? null,
      tenantName,
      clientTenantId,
      allocateId: newJuryId,
      now: new Date().toISOString(),
    });
    redirect(`/jury?result=${decision.ok ? 'OK' : decision.reason}`);
  } catch (error) {
    if (isJuryStoreUnavailable(error)) redirect('/jury?result=STORE_UNAVAILABLE');
    throw error;
  }
}

export async function changeJuryMembership(formData: FormData): Promise<void> {
  const clientTenantId = String(formData.get('tenantId') ?? '');
  const targetUserId = String(formData.get('targetUserId') ?? '').trim();
  const roleValue = String(formData.get('role') ?? '');
  const command = String(formData.get('command') ?? '');
  const actor = await getJuryActor(clientTenantId);
  if (!actor.ok) redirect(`/jury/settings?result=${actor.reason}`);
  if (command !== 'ADD_MEMBER' && command !== 'CHANGE_ROLE' && command !== 'REMOVE_MEMBER') {
    redirect('/jury/settings?result=FORBIDDEN');
  }
  if ((command === 'ADD_MEMBER' || command === 'CHANGE_ROLE') && !isRole(roleValue)) {
    redirect('/jury/settings?result=FORBIDDEN');
  }
  try {
    const decision =
      command === 'ADD_MEMBER'
        ? await persistMembershipCommand({
            kind: 'ADD_MEMBER',
            actor,
            targetUserId,
            role: roleValue as JuryMemberRole,
            clientTenantId,
            allocateId: newJuryId,
            now: new Date().toISOString(),
          })
        : command === 'CHANGE_ROLE'
          ? await persistMembershipCommand({
              kind: 'CHANGE_ROLE',
              actor,
              targetUserId,
              role: roleValue as JuryMemberRole,
              clientTenantId,
            })
          : await persistMembershipCommand({
              kind: 'REMOVE_MEMBER',
              actor,
              targetUserId,
              clientTenantId,
            });
    redirect(`/jury/settings?result=${decision.ok ? 'OK' : decision.reason}`);
  } catch (error) {
    if (isJuryStoreUnavailable(error)) redirect('/jury/settings?result=STORE_UNAVAILABLE');
    throw error;
  }
}

export async function registerJuryService(formData: FormData): Promise<void> {
  const clientTenantId = String(formData.get('tenantId') ?? '');
  const actor = await getJuryActor(clientTenantId);
  if (!actor.ok) redirect(`/jury/services?result=${actor.reason}`);
  const accessMethod = String(formData.get('accessMethod') ?? '');
  if (!isAccessMethod(accessMethod)) redirect('/jury/services?result=FORBIDDEN');
  try {
    const decision = await persistServiceTarget({
      actor,
      serviceKey: String(formData.get('serviceKey') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      accessMethod,
      credentialRef: String(formData.get('credentialRef') ?? ''),
      clientTenantId,
      allocateId: newJuryId,
      now: new Date().toISOString(),
    });
    redirect(`/jury/services?result=${decision.ok ? 'SERVICE_REGISTERED' : decision.reason}`);
  } catch (error) {
    if (isJuryStoreUnavailable(error)) redirect('/jury/services?result=STORE_UNAVAILABLE');
    throw error;
  }
}

export async function runJuryDiscovery(formData: FormData): Promise<void> {
  const clientTenantId = String(formData.get('tenantId') ?? '');
  const actor = await getJuryActor(clientTenantId);
  if (!actor.ok) redirect(`/jury/discovery?result=${actor.reason}`);
  try {
    const decision = await persistMockDiscovery({
      actor,
      connectionId: String(formData.get('connectionId') ?? ''),
      clientTenantId,
      allocateId: newJuryId,
      now: new Date().toISOString(),
    });
    redirect(`/jury/discovery?result=${decision.ok ? 'DISCOVERY_RECORDED' : decision.reason}`);
  } catch (error) {
    if (isJuryStoreUnavailable(error)) redirect('/jury/discovery?result=STORE_UNAVAILABLE');
    throw error;
  }
}

export async function decideJuryScope(formData: FormData): Promise<void> {
  const clientTenantId = String(formData.get('tenantId') ?? '');
  const decisionName = String(formData.get('decision') ?? '');
  const actor = await getJuryActor(clientTenantId);
  if (!actor.ok) redirect(`/jury/discovery?result=${actor.reason}`);
  if (decisionName !== 'APPROVE' && decisionName !== 'REJECT') redirect('/jury/discovery?result=FORBIDDEN');
  try {
    const decision = await persistScopeDecision({
      actor,
      scopeId: String(formData.get('scopeId') ?? ''),
      decision: decisionName,
      clientTenantId,
      now: new Date().toISOString(),
    });
    redirect(`/jury/discovery?result=${decision.ok ? decision.audit.action : decision.reason}`);
  } catch (error) {
    if (isJuryStoreUnavailable(error)) redirect('/jury/discovery?result=STORE_UNAVAILABLE');
    throw error;
  }
}

export async function proposeCatalogScope(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/discovery?result=${actor.reason}`);
  let code = 'PERSISTENCE_FAILED';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const decision = await persistCatalogScope({
      userId: actor.userId,
      memberships,
      clientTenantId: null,
      connectionId: String(formData.get('connectionId') ?? ''),
      metric: String(formData.get('metric') ?? ''),
      now: new Date().toISOString(),
    });
    code = catalogScopeCode(decision);
  } catch (error) {
    code = isJuryStoreUnavailable(error) ? 'STORE_UNAVAILABLE' : 'PERSISTENCE_FAILED';
  }
  redirect(`/jury/discovery?result=${code}`);
}

export async function decideCatalogScope(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/discovery?result=${actor.reason}`);
  const decisionName = String(formData.get('decision') ?? '');
  if (decisionName !== 'APPROVE' && decisionName !== 'REJECT') redirect('/jury/discovery?result=FORBIDDEN');
  let code = 'PERSISTENCE_FAILED';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const decision = await persistCatalogScopeDecision({
      userId: actor.userId,
      memberships,
      clientTenantId: null,
      scopeId: String(formData.get('scopeId') ?? ''),
      decision: decisionName,
      now: new Date().toISOString(),
    });
    code = catalogScopeCode(decision);
  } catch (error) {
    code = isJuryStoreUnavailable(error) ? 'STORE_UNAVAILABLE' : 'PERSISTENCE_FAILED';
  }
  redirect(`/jury/discovery?result=${code}`);
}

export async function submitTenantEvidenceIntake(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/evidence?result=${actor.reason}`);
  let code = 'PERSISTENCE_FAILED';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const built = buildConsoleIntakeInput({
      userId: actor.userId,
      memberships,
      connectionId: String(formData.get('connectionId') ?? ''),
      scopeId: String(formData.get('scopeId') ?? ''),
      metric: String(formData.get('metric') ?? ''),
      availability: String(formData.get('availability') ?? ''),
      value: String(formData.get('value') ?? ''),
      now: new Date().toISOString(),
    });
    if (!built.ok) {
      code = built.reason;
    } else {
      const decision = await persistTenantEvidenceIntake({ ...built.intake, clientTenantId: null });
      code = consoleIntakeCode(decision);
    }
  } catch (error) {
    code = isJuryStoreUnavailable(error) ? 'STORE_UNAVAILABLE' : 'PERSISTENCE_FAILED';
  }
  redirect(`/jury/evidence?result=${code}`);
}

export async function submitTenantReview(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/evidence?result=${actor.reason}`);
  const reviewAccess = await guardEvidenceFeature(actor, String(formData.get('evidenceId') ?? ''), 'review.execute');
  if (!reviewAccess.ok) redirect(`/jury/evidence?result=${reviewAccess.reason === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND'}`);
  let target = '/jury/evidence?result=PERSISTENCE_FAILED';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await runTenantReview(
      {
        userId: actor.userId,
        memberships,
        clientTenantId: null,
        evidenceId: String(formData.get('evidenceId') ?? ''),
        reviewType: String(formData.get('reviewType') ?? ''),
        claim: null,
        now: new Date().toISOString(),
      },
      tenantReviewCore,
    );
    target = outcome.ok
      ? `/jury/reviews/${outcome.result.id}`
      : `/jury/evidence?result=${tenantReviewCode(outcome.reason)}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/evidence?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function acknowledgeHumanReview(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const reviewId = String(formData.get('reviewId') ?? '');
  const reviewAccess = await guardReviewFeature(actor, reviewId, 'review.execute');
  if (!reviewAccess.ok) redirect(`/jury/reviews?result=${reviewAccess.reason === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND'}`);
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await noteHumanNextAction({
      userId: actor.userId,
      memberships,
      reviewId,
      action: String(formData.get('action') ?? ''),
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}?human=NOTED`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function createHumanImprovementTask(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const reviewId = String(formData.get('reviewId') ?? '');
  const improvementAccess = await guardReviewFeature(actor, reviewId, 'improvement.write');
  if (!improvementAccess.ok) redirect(`/jury/reviews?result=${improvementAccess.reason === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND'}`);
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await persistHumanImprovement({
      userId: actor.userId,
      memberships,
      reviewId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function handoffHumanImprovement(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const improvementTaskId = String(formData.get('improvementTaskId') ?? '');
  const handoffAccess = await guardImprovementFeature(actor, improvementTaskId, 'improvement.write');
  if (!handoffAccess.ok) redirect(`/jury/reviews?result=${handoffAccess.reason === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND'}`);
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await handoffProductImprovement({
      userId: actor.userId,
      memberships,
      improvementTaskId,
      clientTenantId: null,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runHumanAgentExecution(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  const agentAccess = await guardAgentExecutionFeature(actor, agentExecutionId, 'agent.execute');
  if (!agentAccess.ok) redirect(`/jury/reviews?result=${agentAccess.reason === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND'}`);
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await executeProductAgentExecution({
      userId: actor.userId,
      memberships,
      agentExecutionId,
      clientTenantId: null,
      servicePermissions: agentAccess.servicePermissions,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runHumanChangeGate(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await evaluateHumanChangeGate({
      userId: actor.userId,
      memberships,
      agentExecutionId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runProductChangeGate(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await evaluateProductChangeGate({
      userId: actor.userId,
      memberships,
      agentExecutionId,
      clientTenantId: null,
    });
    target = outcome.ok
      ? `/jury/improvements?result=CHANGE_GATE_${outcome.gate.status}`
      : `/jury/improvements?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/improvements?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runProductChangeGateReReview(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/improvements?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/improvements?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await startProductChangeGateReReview({
      userId: actor.userId,
      memberships,
      agentExecutionId,
      clientTenantId: null,
    });
    target = outcome.ok && outcome.reReview.reviewResultId
      ? `/jury/reviews/${outcome.reReview.reviewResultId}`
      : `/jury/improvements?result=${outcome.ok ? 'RE_REVIEW' : outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/improvements?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runHumanReReview(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await evaluateHumanReReview({
      userId: actor.userId,
      memberships,
      agentExecutionId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

async function tenantReviewCore(input: {
  rootDir: typeof JURY_PRODUCT_DATA_ROOT;
  evidence: EvidencePack;
  claim?: string;
}) {
  const { callFrozenReviewPipeline } = await import('@/lib/jury-product/review-core');
  const { createGeminiReviewBoardLlm } = await import('@/lib/ai-review-board');
  const { readGeminiApiKeyFromEnv } = await import('@/lib/gemini-prompt-analysis-engine');
  const key = readGeminiApiKeyFromEnv();
  if (!key.ok) throw new Error('REVIEW_NOT_EXECUTED');
  return callFrozenReviewPipeline({
    rootDir: input.rootDir,
    evidence: input.evidence,
    ...(input.claim ? { claim: input.claim } : {}),
    llm: createGeminiReviewBoardLlm(key.key),
  });
}

export async function createReReviewImprovementTask(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const reReviewResultId = String(formData.get('reReviewResultId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await persistReReviewImprovement({
      userId: actor.userId,
      memberships,
      reReviewResultId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function createSecondReReviewImprovementTask(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const reReviewResultId = String(formData.get('reReviewResultId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await persistSecondReReviewImprovement({
      userId: actor.userId,
      memberships,
      reReviewResultId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function approveReReviewAgentAction(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const improvementTaskId = String(formData.get('improvementTaskId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await approveReReviewAgent({
      userId: actor.userId,
      memberships,
      improvementTaskId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function handoffReReviewImprovement(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const improvementTaskId = String(formData.get('improvementTaskId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await persistReReviewAgentHandoff({
      userId: actor.userId,
      memberships,
      improvementTaskId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runReReviewAgentExecution(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await executeReReviewAgentExecution({
      userId: actor.userId,
      memberships,
      agentExecutionId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runReReviewChangeGate(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await evaluateReReviewChangeGate({
      userId: actor.userId,
      memberships,
      agentExecutionId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runSecondReReview(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await evaluateSecondReReview({
      userId: actor.userId,
      memberships,
      agentExecutionId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function approveSecondImprovementTask(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const improvementTaskId = String(formData.get('improvementTaskId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await approveSecondImprovement({
      userId: actor.userId,
      memberships,
      improvementTaskId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function handoffSecondImprovementTask(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const improvementTaskId = String(formData.get('improvementTaskId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await handoffSecondImprovement({
      userId: actor.userId,
      memberships,
      improvementTaskId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runSecondChangeGate(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await evaluateSecondChangeGate({
      userId: actor.userId,
      memberships,
      agentExecutionId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runLaterReReview(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await evaluateLaterReReview({
      userId: actor.userId,
      memberships,
      agentExecutionId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function createLaterReReviewImprovementTask(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const reReviewResultId = String(formData.get('reReviewResultId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await persistLaterReReviewImprovement({
      userId: actor.userId,
      memberships,
      reReviewResultId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function approveLaterImprovementTask(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const improvementTaskId = String(formData.get('improvementTaskId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await approveLaterImprovement({
      userId: actor.userId,
      memberships,
      improvementTaskId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function handoffLaterImprovementTask(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const improvementTaskId = String(formData.get('improvementTaskId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await handoffLaterImprovement({
      userId: actor.userId,
      memberships,
      improvementTaskId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runLaterAgentExecution(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await executeLaterAgentExecution({
      userId: actor.userId,
      memberships,
      agentExecutionId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runLaterChangeGate(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await evaluateLaterChangeGate({
      userId: actor.userId,
      memberships,
      agentExecutionId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

export async function runFollowingReReview(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/reviews?result=${actor.reason}`);
  const agentExecutionId = String(formData.get('agentExecutionId') ?? '');
  let target = '/jury/reviews?result=NOT_FOUND';
  try {
    const memberships = await listMembershipsForUser(actor.userId);
    const outcome = await evaluateFollowingReReview({
      userId: actor.userId,
      memberships,
      agentExecutionId,
    });
    target = outcome.ok
      ? `/jury/reviews/${outcome.reviewId}`
      : `/jury/reviews?result=${outcome.reason}`;
  } catch (error) {
    target = isJuryStoreUnavailable(error) ? '/jury/reviews?result=STORE_UNAVAILABLE' : target;
  }
  redirect(target);
}

function onboardingValue(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '');
}

function safeConnectionId(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) return null;
  return value;
}

export async function startServiceOnboarding(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  if (!actor.ok) redirect(`/jury/services/new?result=${actor.reason}`);
  const accessMethod = onboardingValue(formData, 'accessMethod');
  if (!isAccessMethod(accessMethod)) redirect('/jury/services/new?result=NOT_IMPLEMENTED');
  let target = '/jury/services/new?result=STORE_UNAVAILABLE';
  try {
    const decision = await persistServiceOnboarding({
      actor,
      serviceKey: onboardingValue(formData, 'serviceKey'),
      displayName: onboardingValue(formData, 'displayName'),
      accessMethod,
      credentialRef: onboardingValue(formData, 'credentialRef'),
      adapterKey: onboardingValue(formData, 'adapterKey'),
      clientTenantId: null,
      allocateId: newJuryId,
      now: new Date().toISOString(),
    });
    target = decision.ok
      ? `/jury/services/${decision.connectionId}`
      : `/jury/services/new?result=${decision.reason}`;
  } catch (error) {
    if (!isJuryStoreUnavailable(error)) throw error;
  }
  redirect(target);
}

export async function runOnboardingDiscovery(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  const connectionId = safeConnectionId(onboardingValue(formData, 'connectionId'));
  if (!actor.ok) redirect(`/jury/services?result=${actor.reason}`);
  if (!connectionId) redirect('/jury/services?result=NOT_FOUND');
  let target = `/jury/services/${connectionId}?result=STORE_UNAVAILABLE`;
  try {
    const decision = await persistOnboardingDiscovery({
      actor,
      connectionId,
      clientTenantId: null,
      allocateId: newJuryId,
      now: new Date().toISOString(),
    });
    target = `/jury/services/${connectionId}?result=${decision.ok ? 'DISCOVERY_RECORDED' : decision.reason}`;
  } catch (error) {
    if (!isJuryStoreUnavailable(error)) throw error;
  }
  redirect(target);
}

export async function decideOnboardingScope(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  const connectionId = safeConnectionId(onboardingValue(formData, 'connectionId'));
  const decisionName = onboardingValue(formData, 'decision');
  if (!actor.ok) redirect(`/jury/services?result=${actor.reason}`);
  if (!connectionId) redirect('/jury/services?result=NOT_FOUND');
  if (decisionName !== 'APPROVE' && decisionName !== 'REJECT') redirect(`/jury/services/${connectionId}?result=FORBIDDEN`);
  let target = `/jury/services/${connectionId}?result=STORE_UNAVAILABLE`;
  try {
    const decision = await persistOnboardingScopeDecision({
      actor,
      scopeId: onboardingValue(formData, 'scopeId'),
      decision: decisionName,
      clientTenantId: null,
      now: new Date().toISOString(),
    });
    const nextId = decision.ok ? decision.connectionId : connectionId;
    target = decision.ok
      ? `/jury/services/${nextId}?result=${decision.activated ? 'SERVICE_CONNECTED' : decision.auditAction}`
      : `/jury/services/${connectionId}?result=${decision.reason}`;
  } catch (error) {
    if (!isJuryStoreUnavailable(error)) throw error;
  }
  redirect(target);
}

export async function collectConnectedServiceEvidence(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  const connectionId = safeConnectionId(onboardingValue(formData, 'connectionId'));
  if (!actor.ok) redirect(`/jury/services?result=${actor.reason}`);
  if (!connectionId) redirect('/jury/services?result=NOT_FOUND');
  let target = `/jury/services/${connectionId}?result=STORE_UNAVAILABLE`;
  try {
    const decision = await runConnectedServiceEvidenceCollection({
      actor,
      connectionId,
      purpose: onboardingValue(formData, 'purpose'),
      periodStart: onboardingValue(formData, 'periodStart'),
      periodEnd: onboardingValue(formData, 'periodEnd'),
      timezone: onboardingValue(formData, 'timezone'),
      clientTenantId: null,
    });
    target = decision.ok
      ? `/jury/services/${connectionId}?result=${decision.created ? 'EVIDENCE_RECORDED' : 'EVIDENCE_REUSED'}`
      : `/jury/services/${connectionId}?result=${decision.reason}`;
  } catch (error) {
    if (!isJuryStoreUnavailable(error)) throw error;
  }
  redirect(target);
}

export async function runConnectedServiceJuryReview(formData: FormData): Promise<void> {
  const actor = await getJuryActor();
  const connectionId = safeConnectionId(onboardingValue(formData, 'connectionId'));
  const evidenceId = onboardingValue(formData, 'evidenceId');
  if (!actor.ok) redirect(`/jury/services?result=${actor.reason}`);
  if (!connectionId || !/^[a-f0-9]{64}$/.test(evidenceId)) redirect('/jury/services?result=NOT_FOUND');
  const reviewAccess = await guardServiceFeature({
    actor,
    feature: 'review.execute',
    connectionId,
    clientTenantId: null,
    actingUserId: null,
    actorRole: null,
    permission: null,
    capability: null,
  });
  if (!reviewAccess.ok) redirect(`/jury/services/${connectionId}?result=${reviewAccess.reason === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND'}`);
  let target = `/jury/services/${connectionId}?result=STORE_UNAVAILABLE`;
  try {
    const decision = await runConnectedServiceReview({
      actor,
      connectionId,
      evidenceId,
      clientTenantId: null,
      core: tenantReviewCore,
    });
    target = decision.ok
      ? `/jury/reviews/${decision.resultId}`
      : `/jury/services/${connectionId}?result=${decision.reason}`;
  } catch (error) {
    if (!isJuryStoreUnavailable(error)) throw error;
  }
  redirect(target);
}
