/**
 * I-062: one screen audit (화면 심사) = one read-only observation with the audit hook attached, then rule analysis and
 * persistence (audit, pages, masked screenshot evidence, test cases/results per area×viewport, findings). Every row
 * carries tenantId. Authorization runs before any row is written. No real run happens in tests (fakes only).
 */
import { randomUUID } from 'node:crypto';
import type { JuryActor } from '../../access';
import { authorizeReadonlyAccountConnection } from '../readonly-account/consent';
import { READONLY_ACCOUNT_CONSENT_VERSION } from '../readonly-account/consent-text';
import type { ObservationDriver } from '../readonly-account/executor';
import type { KeyProviderResolution } from '../readonly-account/key-provider';
import { runStoredCredentialObservation, type ObservationRunStore } from '../readonly-account/observation-run';
import { createAuditHook, mobileOriginsNotAllowed, type AuditPageResult } from './audit-hook';
import { summarizeAudit, type AreaSummary, type AuditStatus, type Finding } from './rules';
import { createMaskedCapture, screenshotExpiry, type ScreenshotSink } from './screenshot-store';
import { AUDIT_LIMITS, DEFAULT_AUDIT_VIEWPORTS } from './viewports';
import { evaluateVisual, SCREEN_AUDIT_AI_ENABLED, type AiVisualEvaluator } from './ai-visual';

/** Screen audit switch (the browser executor keeps its own READONLY_ACCOUNT_EXECUTOR_ENABLED gate). */
export const SCREEN_AUDIT_ENABLED = true as boolean;
export const SCREEN_AUDIT_AUDIT_EVENT = 'SCREEN_AUDIT_RUN';

export const AREA_TITLES: Record<string, string> = {
  LAYOUT: '레이아웃이 화면 폭 안에 들어오고 글자가 잘리지 않는다',
  MOBILE: '모바일에서 가로 스크롤 없이 누르기 쉬운 크기로 보인다',
  A11Y: '글자 명암비와 제목 구조가 접근성 기준을 만족한다',
  NAVIGATION: '메뉴(내비게이션)가 보인다',
};

export type AuditRows = {
  pages: { id: string; path: string; label: string; viewport: string; status: AuditStatus; metrics: unknown | null; capturedAt?: Date }[];
  evidence: { id: string; pageId: string; kind: 'SCREENSHOT'; storageKey: string; sha256: string; byteSize: number; width: number; height: number; data: { maskedCount: number }; expiresAt: Date }[];
  testCases: { id: string; key: string; area: string; viewport: string; title: string; result: { id: string; status: AuditStatus; detail: AreaSummary } }[];
  findings: { id: string; pageId: string | null; area: string; rule: string; severity: string; status: AuditStatus; viewport: string; message: string; evidenceIds: string[]; boxes: Finding['boxes']; envLimited?: boolean }[];
};

/** I-068: page metrics JSON keeps the old shape; env / reason / mobileOrigin are added only when present. */
function pageMetricsJson(r: AuditPageResult): Record<string, unknown> | null {
  const extra = { ...(r.env ? { env: r.env } : {}), ...(r.mobileOrigin ? { mobileOrigin: r.mobileOrigin } : {}) };
  if (r.metrics) return Object.keys(extra).length ? { ...r.metrics, ...extra } : (r.metrics as unknown as Record<string, unknown>);
  return r.reason ? { reason: r.reason, ...extra } : null;
}

export function buildAuditRows(results: readonly AuditPageResult[], now: Date, id: () => string = randomUUID) {
  const summary = summarizeAudit(results);
  const rows: AuditRows = { pages: [], evidence: [], testCases: [], findings: [] };
  const pageIds = new Map<string, string>();
  const shotIds = new Map<string, string>();
  for (const r of results) {
    const pid = id();
    pageIds.set(`${r.path}|${r.viewport}`, pid);
    rows.pages.push({ id: pid, path: r.path, label: r.label, viewport: r.viewport, status: r.status, metrics: pageMetricsJson(r), ...(r.capturedAt ? { capturedAt: new Date(r.capturedAt) } : {}) });
    if (r.capture) {
      const eid = id();
      shotIds.set(`${r.path}|${r.viewport}`, eid);
      rows.evidence.push({ id: eid, pageId: pid, kind: 'SCREENSHOT', storageKey: r.capture.storageKey, sha256: r.capture.sha256, byteSize: r.capture.byteSize, width: r.capture.width, height: r.capture.height, data: { maskedCount: r.capture.maskedCount }, expiresAt: screenshotExpiry(now) });
    }
  }
  for (const a of summary.areas) {
    rows.testCases.push({ id: id(), key: a.area, area: a.area, viewport: a.viewport, title: AREA_TITLES[a.area] ?? a.area, result: { id: id(), status: a.status, detail: a } });
  }
  for (const f of summary.findings) {
    const k = `${f.path}|${f.viewport}`;
    const shot = shotIds.get(k);
    rows.findings.push({ id: id(), pageId: pageIds.get(k) ?? null, area: f.area, rule: f.rule, severity: f.severity, status: f.status === 'FAIL' ? 'FAIL' : 'PARTIAL', viewport: f.viewport, message: f.message, evidenceIds: shot ? [shot] : [], boxes: f.boxes, ...(f.envLimited ? { envLimited: true } : {}) });
  }
  return { summary, rows };
}

export interface ScreenAuditStore {
  createAudit(a: { id: string; tenantId: string; connectionId: string; actorUserId: string; parentAuditId: string | null; consentVersion: string; viewports: string[]; aiEnabled: boolean; startedAt: Date }): Promise<void>;
  finishAudit(a: { id: string; tenantId: string; state: 'DONE' | 'FAILED'; status: AuditStatus; summary: unknown; finishedAt: Date; rows: AuditRows }): Promise<void>;
  findAudit?(tenantId: string, auditId: string): Promise<{ id: string; connectionId: string } | null>;
}

export type ScreenAuditResult =
  | { ok: true; auditId: string; status: AuditStatus; areas: AreaSummary[]; findings: number; stop: string | null }
  | { ok: false; reason: string };

export async function runScreenAudit(input: {
  actor: JuryActor;
  connectionId: string;
  parentAuditId?: string | null;
  observationStore: ObservationRunStore;
  auditStore: ScreenAuditStore;
  keys: KeyProviderResolution;
  createDriver: () => ObservationDriver;
  createSink?: () => Promise<ScreenshotSink>;
  executorEnabled?: boolean;
  enabled?: boolean;
  now?: () => Date;
  clock?: () => number;
  /** I-066: AI visual evaluation, OFF unless enabled AND an evaluator is passed. Advisory only. */
  ai?: { enabled?: boolean; evaluator?: AiVisualEvaluator | null };
}): Promise<ScreenAuditResult> {
  if (!(input.enabled ?? SCREEN_AUDIT_ENABLED)) return { ok: false, reason: 'NOT_IMPLEMENTED' };
  const now = input.now ?? (() => new Date());
  const tenantId = input.actor.ok ? input.actor.tenantId : null;
  const connection = tenantId ? await input.observationStore.findConnection(tenantId, input.connectionId) : null;
  const auth = authorizeReadonlyAccountConnection(input.actor, connection);
  if (!auth.ok) return auth;
  const parentAuditId = input.parentAuditId || null;
  if (parentAuditId) {
    const parent = input.auditStore.findAudit ? await input.auditStore.findAudit(auth.connection.tenantId, parentAuditId) : null;
    if (!parent || parent.connectionId !== auth.connection.id) return { ok: false, reason: 'PARENT_NOT_FOUND' };
  }
  const auditId = randomUUID();
  const startedAt = now();
  await input.auditStore.createAudit({
    id: auditId, tenantId: auth.connection.tenantId, connectionId: auth.connection.id, actorUserId: auth.actor.userId, parentAuditId,
    consentVersion: READONLY_ACCOUNT_CONSENT_VERSION, viewports: DEFAULT_AUDIT_VIEWPORTS.map((v) => v.name), aiEnabled: Boolean((input.ai?.enabled ?? SCREEN_AUDIT_AI_ENABLED) && input.ai?.evaluator), startedAt,
  });
  const driver = input.createDriver();
  let sink: ScreenshotSink | null = null;
  try {
    sink = input.createSink ? await input.createSink() : null;
  } catch {
    sink = null; // screenshots are optional evidence; metrics still run
  }
  const hook = createAuditHook({
    driver,
    clock: input.clock,
    capture: sink ? createMaskedCapture({ driver, sink, tenantId: auth.connection.tenantId, auditId }) : undefined,
  });
  let stop: string | null = null;
  let failed = false;
  try {
    const obs = await runStoredCredentialObservation({
      actor: input.actor,
      connectionId: auth.connection.id,
      scope: { allowedOrigins: [], paths: [], authOrigins: [] },
      login: { loginUrl: '', usernameSelector: '', passwordSelector: '', submitSelector: '', successPathPrefix: '' },
      store: input.observationStore,
      keys: input.keys,
      createDriver: () => driver,
      executorEnabled: input.executorEnabled,
      discover: { maxPages: AUDIT_LIMITS.discoveryMaxPages, budgetMs: AUDIT_LIMITS.discoveryBudgetMs },
      onPage: hook.onPage,
    });
    if (!obs.ok) {
      stop = obs.reason;
      failed = true;
    } else if (!obs.summary.ok) stop = obs.summary.stop ?? 'STOPPED';
  } catch {
    stop = 'ERROR';
    failed = true;
  }
  const { summary, rows } = buildAuditRows(hook.results, startedAt);
  const ai = await evaluateVisual(
    {
      shots: rows.evidence.map((e) => {
        const page = rows.pages.find((p) => p.id === e.pageId);
        return { storageKey: e.storageKey, viewport: page?.viewport ?? '', path: page?.path ?? '' };
      }),
      metrics: rows.pages.filter((p) => p.status === 'PASS').map((p) => ({ viewport: p.viewport, path: p.path, metrics: p.metrics })),
    },
    { enabled: input.ai?.enabled, evaluator: input.ai?.evaluator },
  );
  const status: AuditStatus = failed ? 'ERROR' : hook.results.length === 0 ? (stop ? 'BLOCKED' : 'NOT_TESTED') : stop && summary.status === 'PASS' ? 'PARTIAL' : summary.status;
  await input.auditStore.finishAudit({
    id: auditId, tenantId: auth.connection.tenantId, state: failed ? 'FAILED' : 'DONE', status,
    summary: { areas: summary.areas, findings: summary.findings.length, stop, ai, mobileOriginsNotAllowed: mobileOriginsNotAllowed(hook.results), envLimitedFindings: summary.findings.filter((f) => f.envLimited).length, pages: new Set(hook.results.map((r) => r.path)).size, elapsedMs: hook.elapsedMs() },
    finishedAt: now(), rows,
  });
  return { ok: true, auditId, status, areas: summary.areas, findings: summary.findings.length, stop };
}

export async function createPrismaScreenAuditStore(): Promise<ScreenAuditStore> {
  const { prisma } = await import('@/lib/prisma');
  const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));
  return {
    async createAudit(a) {
      await prisma.juryVisualAudit.create({ data: { ...a, state: 'RUNNING', viewports: a.viewports } });
    },
    async findAudit(tenantId, auditId) {
      return prisma.juryVisualAudit.findFirst({ where: { id: auditId, tenantId }, select: { id: true, connectionId: true } });
    },
    async finishAudit(a) {
      const t = a.tenantId;
      const r = a.rows;
      await prisma.$transaction([
        prisma.juryAuditPage.createMany({ data: r.pages.map((p) => ({ id: p.id, auditId: a.id, tenantId: t, path: p.path, label: p.label, viewport: p.viewport, status: p.status, metrics: json(p.metrics), capturedAt: p.capturedAt ?? a.finishedAt })) }),
        prisma.juryAuditEvidence.createMany({ data: r.evidence.map((e) => ({ id: e.id, auditId: a.id, pageId: e.pageId, tenantId: t, kind: e.kind, storageKey: e.storageKey, sha256: e.sha256, masked: true, byteSize: e.byteSize, width: e.width, height: e.height, data: json(e.data), expiresAt: e.expiresAt })) }),
        prisma.juryAuditTestCase.createMany({ data: r.testCases.map((c) => ({ id: c.id, auditId: a.id, tenantId: t, key: c.key, area: c.area, viewport: c.viewport, title: c.title })) }),
        prisma.juryAuditTestResult.createMany({ data: r.testCases.map((c) => ({ id: c.result.id, testCaseId: c.id, auditId: a.id, tenantId: t, status: c.result.status, detail: json(c.result.detail) })) }),
        prisma.juryAuditFinding.createMany({ data: r.findings.map((f) => ({ id: f.id, auditId: a.id, pageId: f.pageId, tenantId: t, area: f.area, rule: f.rule, source: 'RULE', severity: f.severity, status: f.status, viewport: f.viewport, message: f.message, evidenceIds: json({ ids: f.evidenceIds, boxes: f.boxes, ...(f.envLimited ? { envLimited: true } : {}) }) })) }),
        prisma.juryVisualAudit.updateMany({ where: { id: a.id, tenantId: t }, data: { state: a.state, status: a.status, summary: json(a.summary), finishedAt: a.finishedAt } }),
      ]);
    },
  };
}
