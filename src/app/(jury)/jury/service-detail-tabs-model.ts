/** I-051: service detail page areas (pure; no CSS so node tests can import it). */
import { juryHref } from '@/lib/jury-product/jury-url';

export const SERVICE_TABS = [
  { key: 'overview', label: '개요' },
  { key: 'connect', label: '연결 설정' },
  { key: 'results', label: '관찰 결과' },
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
