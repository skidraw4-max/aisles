/** /jury/evidence: which service each evidence row belongs to (display only, from the already-loaded view). */
import type { JuryConsoleView } from './console-view';

export type EvidenceServiceInfo = {
  id: string;
  name: string;
  /** Host when serviceKey is a URL, otherwise the key itself. */
  domain: string;
  status: string;
  /** Deleting a connection keeps the row and sets DISCONNECTED. */
  deleted: boolean;
};

export function serviceDomain(serviceKey: string): string {
  try {
    const url = new URL(serviceKey);
    if (url.hostname) return url.hostname;
  } catch {
    // not a URL
  }
  return serviceKey;
}

export function evidenceServiceInfo(view: Pick<JuryConsoleView, 'connections' | 'tenantId'>, connectionId: string | null | undefined): EvidenceServiceInfo | null {
  if (!connectionId) return null;
  const row = view.connections.find((item) => item.id === connectionId && item.tenantId === view.tenantId);
  if (!row) return null;
  return { id: row.id, name: row.displayName, domain: serviceDomain(row.serviceKey), status: row.status, deleted: row.status === 'DISCONNECTED' };
}

/** Filter options: active services by name, deleted services at the bottom. Empty when there is only one service. */
export function evidenceServiceFilter(
  view: Pick<JuryConsoleView, 'connections' | 'tenantId'>,
  connectionIds: readonly string[],
): { options: string[]; labelOf: (id: string) => string } {
  const infos = [...new Set(connectionIds)].map((id) => evidenceServiceInfo(view, id)).filter((v): v is EvidenceServiceInfo => v !== null);
  const byName = (a: EvidenceServiceInfo, b: EvidenceServiceInfo) => a.name.localeCompare(b.name, 'ko');
  const ordered = [...infos.filter((i) => !i.deleted).sort(byName), ...infos.filter((i) => i.deleted).sort(byName)];
  const labels = new Map(ordered.map((i) => [i.id, i.deleted ? `삭제된 서비스 · ${i.name}` : i.name]));
  return { options: ordered.length > 1 ? ordered.map((i) => i.id) : [], labelOf: (id) => labels.get(id) ?? '서비스 정보 없음' };
}
