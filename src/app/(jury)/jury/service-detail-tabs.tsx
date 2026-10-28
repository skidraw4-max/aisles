/**
 * I-051: service detail page areas. Tabs are plain links driven by ?tab= so the page stays a server component.
 * I-070: own sticky bar under the summary header, button-style tabs with per-tab status badges.
 */
import Link from 'next/link';
import { serviceTabHref, visibleServiceTabs, type ServiceTab, type ServiceTabBadge } from './service-detail-tabs-model';
import { ServiceTabScroll } from './service-tab-scroll';
import { ServiceTabPending } from './service-tab-pending';
import styles from './jury.module.css';
import { StatusBadge } from './jury-controls';
import type { StatusTone } from '@/lib/jury-product/status-tone';

export { parseServiceTab, serviceTabBadges, type ServiceTab } from './service-detail-tabs-model';

const TONE: Record<ServiceTabBadge['tone'], StatusTone> = {
  ok: 'pass',
  warn: 'partial',
  muted: 'neutral',
};

export function ServiceTabNav({
  connectionId,
  active,
  badges = {},
  hidden = [],
}: {
  connectionId: string;
  active: ServiceTab;
  badges?: Partial<Record<ServiceTab, ServiceTabBadge>>;
  /** I-085: areas that are not usable for this connection are hidden (the active one always stays). */
  hidden?: readonly ServiceTab[];
}) {
  const id = `service-tabs-${connectionId}`;
  return (
    <nav className={styles.serviceTabBar} aria-label="서비스 영역">
      <div id={id} className={`${styles.serviceTabs} ${styles.segTabs}`} role="tablist" aria-label="서비스 영역">
        {visibleServiceTabs(hidden, active).map((t) => {
          const selected = t.key === active;
          const badge = badges[t.key];
          return (
            <Link
              key={t.key}
              href={serviceTabHref(connectionId, t.key)}
              role="tab"
              aria-selected={selected}
              aria-current={selected ? 'page' : undefined}
              data-active={selected ? 'true' : undefined}
              className={selected ? `${styles.segTab} ${styles.segTabActive}` : styles.segTab}
            >
              <span>{t.label}</span>
              <ServiceTabPending />
              {badge ? <StatusBadge tone={TONE[badge.tone]}>{badge.text}</StatusBadge> : null}
            </Link>
          );
        })}
      </div>
      <ServiceTabScroll containerId={id} active={active} />
    </nav>
  );
}
