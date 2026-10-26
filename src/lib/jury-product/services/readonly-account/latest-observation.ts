/**
 * I-047: read model for the most recent READ_ONLY_ACCOUNT observation run (PII-free counts and paths only).
 * Shared by the service detail page ("최근 관찰 결과") and evidence collection.
 */
export type LatestObservationRun = {
  id: string;
  ok: boolean;
  stop: string | null;
  challenge: string | null;
  loginAttempts: number;
  pagesObserved: number;
  pagesVisible: number;
  pages: { label: string; path: string; visible: boolean; textLength: number }[];
  blockedRequestCount: number;
  blockedByReason: { ORIGIN: number; METHOD: number; FORM_SUBMIT: number; LOGIN_ALREADY_USED: number };
  finalOrigin: string | null;
  finalPath: string | null;
  observedAt: string;
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
        return [{ label: String(r.label ?? '').slice(0, 64), path: String(r.path ?? ''), visible: r.visible === true, textLength: num(r.textLength) }];
      })
    : [];
  const b = (row.blockedByReason && typeof row.blockedByReason === 'object' ? row.blockedByReason : {}) as Record<string, unknown>;
  return {
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
