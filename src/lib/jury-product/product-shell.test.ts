import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { decideJuryMutation, type JuryActor } from './access';
import { JURY_CONSOLE_FIXTURE } from './console-fixture';
import { readJuryConsole } from './console-view';
import type { ImprovementTrace } from './improvement-trace';
import {
  formatMeasuredValue,
  PRODUCT_NAV,
  projectAudit,
  projectDashboard,
  projectTraceLineage,
  SHELL_EMPTY,
} from './product-shell';

const owner: JuryActor = { ok: true, userId: 'user-owner', tenantId: 'tenant-a', role: 'OWNER', membershipId: 'm-owner' };
const member: JuryActor = { ok: true, userId: 'user-member', tenantId: 'tenant-a', role: 'MEMBER', membershipId: 'm-member' };
const auditor: JuryActor = { ok: true, userId: 'user-auditor', tenantId: 'tenant-a', role: 'AUDITOR', membershipId: 'm-auditor' };

test('product shell navigation opens the console routes', () => {
  for (const item of PRODUCT_NAV) {
    const relative = item.href === '/jury' ? 'src/app/(root)/jury/page.tsx' : `src/app/(root)/jury/${item.href.slice('/jury/'.length)}/page.tsx`;
    assert.equal(existsSync(path.resolve(process.cwd(), relative)), true, item.href);
  }
  assert.deepEqual(PRODUCT_NAV.map((item) => item.label), [
    'Dashboard',
    'Services',
    'Evidence',
    'Reviews',
    'Improvements',
    'Audit',
    'Settings',
  ]);
});

test('product shell keeps tenant rows and does not invent empty counts', () => {
  const view = readJuryConsole(owner, JURY_CONSOLE_FIXTURE);
  assert.ok(view);
  if (!view) return;
  assert.equal(view.connections.some((row) => row.tenantId === 'tenant-b'), false);
  assert.equal(view.audit.some((row) => row.id === 'audit-b'), false);
  const board = projectDashboard(view);
  assert.equal(board.available, true);
  if (!board.available) return;
  assert.equal(board.services, String(view.connections.length));
  assert.equal(board.evidence, String(view.evidence.length));
  assert.equal(board.activity.some((row) => row.id === 'audit-b'), false);
  const empty = projectDashboard({ ...view, connections: [], evidence: [], requests: [], results: [], tasks: [], audit: [] });
  assert.equal(empty.available, true);
  if (!empty.available) return;
  assert.equal(empty.services, '0');
  assert.equal(empty.evidence, '0');
  assert.equal(empty.reviews, '0');
  assert.equal(empty.openImprovements, '0');
  assert.equal(empty.activity.length, 0);
  assert.equal(projectDashboard(null).available, false);
  assert.equal(SHELL_EMPTY.services, 'No services connected yet');
  assert.equal(SHELL_EMPTY.evidence, 'No evidence yet');
  assert.equal(SHELL_EMPTY.reviews, 'No reviews yet');
  assert.equal(SHELL_EMPTY.improvements, 'No improvement tasks yet');
  assert.equal(SHELL_EMPTY.audit, 'No audit events yet');
});

test('measured zero stays distinct from a missing measurement', () => {
  assert.equal(formatMeasuredValue(0, 'AVAILABLE'), '0 · measured zero');
  assert.equal(formatMeasuredValue(4, 'AVAILABLE'), '4');
  assert.equal(formatMeasuredValue(null, 'NOT_MEASURED'), 'Not measured');
  assert.equal(formatMeasuredValue(null, 'NOT_AVAILABLE'), 'Not available');
  assert.equal(formatMeasuredValue(null, 'PERMISSION_DENIED'), 'Permission denied');
  assert.equal(formatMeasuredValue(null, 'COLLECTION_FAILED'), 'Collection failed');
  assert.equal(formatMeasuredValue(0, 'NOT_MEASURED'), 'Not measured');
});

test('audit display redacts secrets and keeps the current tenant event', () => {
  const view = readJuryConsole(owner, JURY_CONSOLE_FIXTURE);
  assert.ok(view);
  if (!view) return;
  const secret = projectAudit({
    ...view,
    audit: [{
      id: 'audit-secret',
      tenantId: 'tenant-a',
      timestamp: '2026-10-04T00:00:00.000Z',
      actor: 'password=hidden',
      action: 'REVIEW_COMPLETED',
      reviewId: 'review-a',
    }],
  });
  assert.equal(secret[0]?.actor, 'REDACTED');
  assert.equal(JSON.stringify(secret).toLowerCase().includes('password'), false);
  assert.equal(projectAudit(view).some((row) => row.resource === 'review-a'), true);
});

test('improvement lineage names missing steps instead of inventing them', () => {
  const trace = {
    rootReviewResult: { id: 'review-a', decision: 'VERIFY', parentReviewResultId: null, overclaimDetected: false },
    decisionTask: null,
    improvementTask: { status: 'OPEN' },
    agentExecutions: [],
    changeGates: [],
    rereviews: [],
    nextHumanApproval: null,
    nextAgentExecution: null,
  } as unknown as ImprovementTrace;
  const lineage = projectTraceLineage(trace);
  assert.equal(lineage.find((row) => row.label === 'Review')?.value, 'VERIFY');
  assert.equal(lineage.find((row) => row.label === 'Improvement Task')?.value, 'OPEN');
  assert.equal(lineage.find((row) => row.label === 'Human Decision')?.value, 'Not started');
  assert.equal(lineage.find((row) => row.label === 'Agent Execution')?.value, 'Not started');
  assert.equal(lineage.find((row) => row.label === 'Change Gate')?.value, 'Not run');
  assert.equal(lineage.find((row) => row.label === 'Re-review')?.value, 'Not reviewed yet');
});

test('auditor stays read-only and the shell does not fall back to fixtures', () => {
  assert.equal(decideJuryMutation({ actor: owner, action: 'console.read', resourceTenantId: owner.tenantId }).ok, true);
  assert.equal(decideJuryMutation({ actor: member, action: 'review.start', resourceTenantId: member.tenantId }).ok, true);
  assert.equal(decideJuryMutation({ actor: member, action: 'agent.execute', resourceTenantId: member.tenantId }).ok, false);
  assert.equal(decideJuryMutation({ actor: auditor, action: 'console.read', resourceTenantId: auditor.tenantId }).ok, true);
  assert.equal(decideJuryMutation({ actor: auditor, action: 'agent.execute', resourceTenantId: auditor.tenantId }).ok, false);
  assert.equal(decideJuryMutation({ actor: auditor, action: 'improvement.write', resourceTenantId: auditor.tenantId }).ok, false);
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/product-shell.ts'), 'utf8');
  for (const token of ['JURY_CONSOLE_FIXTURE', 'phase71', 'evaluateChangeGate', 'persistChangeGateReReview', 'prisma', 'buildEvidencePackFromDb']) {
    assert.equal(source.includes(token), false, token);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  assert.equal(ui.includes('SHELL_UNAVAILABLE'), true);
  assert.equal(ui.includes('No services connected yet'), false);
  assert.equal(ui.includes('SHELL_EMPTY.services'), true);
  assert.equal(ui.includes('Unauthorized'), true);
  assert.equal(ui.includes('Logout'), true);
});
