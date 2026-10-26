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
