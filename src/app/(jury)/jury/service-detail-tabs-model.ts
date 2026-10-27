/** I-051: service detail page areas (pure; no CSS so node tests can import it). */
import { juryHref } from '@/lib/jury-product/jury-url';

export const SERVICE_TABS = [
  { key: 'overview', label: '개요' },
  { key: 'connect', label: '연결 설정' },
  { key: 'results', label: '관찰 결과' },
  { key: 'screen', label: '화면 심사' },
  { key: 'review', label: '심사·개선' },
  { key: 'history', label: '기록' },
] as const;

export type ServiceTab = (typeof SERVICE_TABS)[number]['key'];

export function parseServiceTab(value: string | string[] | undefined): ServiceTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return SERVICE_TABS.some((t) => t.key === raw) ? (raw as ServiceTab) : 'overview';
}

export function serviceTabHref(connectionId: string, tab: ServiceTab): string {
  return juryHref(`/services/${connectionId}`, tab === 'overview' ? undefined : { tab });
}

/** I-052: sessionStorage key for the tab a form was submitted from (server actions redirect without ?tab=). */
export function serviceTabMemoryKey(connectionId: string): string {
  return `jury-service-tab:${connectionId}`;
}

/**
 * I-052: after a server action redirects to `?result=…` without `?tab=`, return the URL (path + query)
 * that restores the saved tab; null when nothing should change.
 */
export function restoreServiceTabUrl(href: string, saved: string | null): string | null {
  if (!saved || saved === 'overview' || !SERVICE_TABS.some((t) => t.key === saved)) return null;
  const url = new URL(href, 'http://local');
  if (url.searchParams.has('tab') || !url.searchParams.has('result')) return null;
  url.searchParams.set('tab', saved);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** I-070: per-tab status badge derived only from data the page already loaded (no extra queries). */
export type ServiceTabBadge = { text: string; tone: 'ok' | 'warn' | 'muted' };

export type ServiceTabBadgeInput = {
  connectionStatus: string;
  onboarding: { discovery: string };
  evidence: { empty: boolean; evidenceItemCount: number };
  review: { empty: boolean; running?: boolean };
  improvement: { openCount: number };
  activity: readonly unknown[];
};

export function serviceTabBadges(
  model: ServiceTabBadgeInput,
  observationNeeded = false,
): Partial<Record<ServiceTab, ServiceTabBadge>> {
  const connectReady = !observationNeeded && model.onboarding.discovery === 'COMPLETE' && model.connectionStatus === 'CONNECTED';
  const badges: Partial<Record<ServiceTab, ServiceTabBadge>> = {
    connect: connectReady ? { text: '✓', tone: 'ok' } : { text: '필요', tone: 'warn' },
    results: model.evidence.empty
      ? { text: '없음', tone: 'muted' }
      : { text: `${model.evidence.evidenceItemCount}건`, tone: 'ok' },
  };
  if (model.review.running) badges.review = { text: '진행 중', tone: 'warn' };
  else if (model.improvement.openCount > 0) badges.review = { text: `개선 ${model.improvement.openCount}`, tone: 'warn' };
  else if (!model.review.empty) badges.review = { text: '✓', tone: 'ok' };
  if (model.activity.length > 0) badges.history = { text: `${model.activity.length}`, tone: 'muted' };
  return badges;
}
