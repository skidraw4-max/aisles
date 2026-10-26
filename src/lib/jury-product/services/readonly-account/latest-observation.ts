/**
 * I-047: read model for the most recent READ_ONLY_ACCOUNT observation run (PII-free counts and paths only).
 * Shared by the service detail page ("최근 관찰 결과") and evidence collection.
 */
import { normalizeStats, type PageStats } from './discovery';

export type LatestObservationRun = {
  id: string;
  ok: boolean;
  stop: string | null;
  challenge: string | null;
  loginAttempts: number;
  pagesObserved: number;
  pagesVisible: number;
  pages: { label: string; path: string; visible: boolean; textLength: number; discovered?: boolean; stats?: PageStats }[];
  blockedRequestCount: number;
  blockedByReason: { ORIGIN: number; METHOD: number; FORM_SUBMIT: number; LOGIN_ALREADY_USED: number };
  /** I-055: blocked hostnames → count (empty for runs recorded before I-055). */
  blockedHosts?: Record<string, number>;
  finalOrigin: string | null;
  finalPath: string | null;
  observedAt: string;
  /** I-056: stop diagnosis (step names only). */
  failedStep?: string | null;
  missingField?: string | null;
};

type Row = {
  id: string;
  ok: boolean;
  stop: string | null;
  challenge: string | null;
  loginAttempts: number;
  pagesObserved: number;
  pagesVisible: number;
  pages: unknown;
  blockedRequestCount: number;
  blockedByReason: unknown;
  finalOrigin: string | null;
  finalPath: string | null;
  observedAt: Date;
};

export interface LatestObservationDb {
  juryReadonlyObservationRun: {
    findFirst(args: { where: Record<string, unknown>; orderBy: { observedAt: 'desc' } }): Promise<Row | null>;
  };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function toLatestObservationRun(row: Row): LatestObservationRun {
  const pages = Array.isArray(row.pages)
    ? row.pages.flatMap((p) => {
        if (!p || typeof p !== 'object') return [];
        const r = p as Record<string, unknown>;
        const stats = normalizeStats(r.stats);
        return [
          {
            label: String(r.label ?? '').slice(0, 64),
            path: String(r.path ?? ''),
            visible: r.visible === true,
            textLength: num(r.textLength),
            ...(r.discovered === true ? { discovered: true } : {}),
            ...(stats ? { stats } : {}),
          },
        ];
      })
    : [];
  const b = (row.blockedByReason && typeof row.blockedByReason === 'object' ? row.blockedByReason : {}) as Record<string, unknown>;
  const rawHosts = b.hosts && typeof b.hosts === 'object' && !Array.isArray(b.hosts) ? (b.hosts as Record<string, unknown>) : {};
  const blockedHosts = Object.fromEntries(
    Object.entries(rawHosts)
      .filter(([h, c]) => /^[a-z0-9.-]{1,253}$/i.test(h) && typeof c === 'number' && c > 0)
      .slice(0, 20)
      .map(([h, c]) => [h, num(c)]),
  );
  const diag = b.diag && typeof b.diag === 'object' ? (b.diag as Record<string, unknown>) : {};
  const token = (v: unknown) => (typeof v === 'string' && /^[A-Z_]{1,32}$/.test(v) ? v : null);
  return {
    ...(token(diag.failedStep) ? { failedStep: token(diag.failedStep) } : {}),
    ...(token(diag.missingField) ? { missingField: token(diag.missingField) } : {}),
    id: row.id,
    ok: row.ok,
    stop: row.stop,
    challenge: row.challenge,
    loginAttempts: row.loginAttempts,
    pagesObserved: row.pagesObserved,
    pagesVisible: row.pagesVisible,
    pages,
    blockedRequestCount: row.blockedRequestCount,
    blockedByReason: { ORIGIN: num(b.ORIGIN), METHOD: num(b.METHOD), FORM_SUBMIT: num(b.FORM_SUBMIT), LOGIN_ALREADY_USED: num(b.LOGIN_ALREADY_USED) },
    blockedHosts,
    finalOrigin: row.finalOrigin,
    finalPath: row.finalPath,
    observedAt: row.observedAt.toISOString(),
  };
}

export async function loadLatestObservationRun(
  db: LatestObservationDb,
  tenantId: string,
  connectionId: string,
  opts: { okOnly?: boolean } = {},
): Promise<LatestObservationRun | null> {
  const row = await db.juryReadonlyObservationRun.findFirst({
    where: { tenantId, connectionId, ...(opts.okOnly ? { ok: true } : {}) },
    orderBy: { observedAt: 'desc' },
  });
  return row ? toLatestObservationRun(row) : null;
}
