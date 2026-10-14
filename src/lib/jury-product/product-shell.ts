/**
 * Read-only labels for the Jury product shell.
 * Counts come from the current tenant view. An empty list is 0. A missing read is not 0.
 */
import { containsSecret } from './agent-execution';
import type { JuryConsoleView } from './console-view';
import type { ImprovementTrace } from './improvement-trace';

export { PRODUCT_NAV } from './product-nav';

export const SHELL_EMPTY = {
  services: 'No services connected yet',
  evidence: 'No evidence yet',
  reviews: 'No reviews yet',
  improvements: 'No improvement tasks yet',
  audit: 'No audit events yet',
} as const;

export const SHELL_UNAVAILABLE = 'Not available';

export function formatMeasuredValue(value: number | null, availability: string): string {
  if (availability === 'AVAILABLE' && typeof value === 'number' && Number.isFinite(value)) {
    return value === 0 ? '0 · measured zero' : String(value);
  }
  if (availability === 'NOT_MEASURED') return 'Not measured';
  if (availability === 'NOT_AVAILABLE') return 'Not available';
  if (availability === 'PERMISSION_DENIED') return 'Permission denied';
  if (availability === 'COLLECTION_FAILED') return 'Collection failed';
  if (availability === 'UNSUPPORTED') return 'Unsupported';
  return SHELL_UNAVAILABLE;
}

export function redactDisplay(value: string | null | undefined): string {
  if (value == null || value.length === 0) return SHELL_UNAVAILABLE;
  if (containsSecret(value)) return 'REDACTED';
  return value;
}

export type ShellActivity = {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  status: string;
};

export type ShellDashboard = {
  available: true;
  services: string;
  evidence: string;
  reviews: string;
  reviewDetail: string;
  openImprovements: string;
  activeImprovements: string;
  activity: ShellActivity[];
} | { available: false };

export function projectDashboard(view: JuryConsoleView | null): ShellDashboard {
  if (!view) return { available: false };
  const byStatus = new Map<string, number>();
  for (const request of view.requests) {
    byStatus.set(request.status, (byStatus.get(request.status) ?? 0) + 1);
  }
  const reviewDetail = byStatus.size === 0
    ? `${view.results.length} results`
    : [...byStatus.entries()].map(([status, count]) => `${status} ${count}`).join(' · ');
  const open = view.tasks.filter((task) => task.status === 'OPEN').length;
  const active = view.tasks.filter((task) => task.status === 'HANDED_OFF' || task.status === 'GATED' || task.status === 'NEEDS_APPROVAL').length;
  return {
    available: true,
    services: String(view.connections.length),
    evidence: String(view.evidence.length),
    reviews: String(view.results.length),
    reviewDetail,
    openImprovements: String(open),
    activeImprovements: String(active),
    activity: projectAudit(view).slice(0, 8),
  };
}

export function projectAudit(view: JuryConsoleView): ShellActivity[] {
  return view.audit.map((event) => {
    const resource = event.reviewId ?? event.evidenceId ?? event.improvementTaskId ?? event.serviceKey ?? event.scopeId ?? null;
    return {
      id: event.id,
      timestamp: redactDisplay(event.timestamp),
      actor: redactDisplay(event.actor),
      action: redactDisplay(event.action),
      resource: redactDisplay(resource),
      status: redactDisplay(event.decision ?? event.testResult ?? event.action),
    };
  });
}

export function projectTraceLineage(trace: ImprovementTrace): Array<{ label: string; value: string }> {
  const human = trace.nextHumanApproval?.decision ?? trace.decisionTask?.decision ?? null;
  const execution = trace.agentExecutions[0]?.status ?? trace.nextAgentExecution?.status ?? null;
  const gate = trace.changeGates[0]?.status ?? null;
  const reviewed = trace.rereviews.find((row) => row.reviewResult)?.reviewResult?.decision ?? null;
  return [
    { label: 'Review', value: trace.rootReviewResult?.decision ?? SHELL_UNAVAILABLE },
    { label: 'Improvement Task', value: trace.improvementTask?.status ?? 'Not started' },
    { label: 'Human Decision', value: human ?? 'Not started' },
    { label: 'Agent Execution', value: execution ?? 'Not started' },
    { label: 'Change Gate', value: gate ?? 'Not run' },
    { label: 'Re-review', value: reviewed ?? 'Not reviewed yet' },
  ];
}
