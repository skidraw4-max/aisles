/**
 * I-051: service detail page areas. Tabs are plain links driven by ?tab= so the page stays a server component.
 * I-070: own sticky bar under the summary header, button-style tabs with per-tab status badges.
 */
import Link from 'next/link';
import { SERVICE_TABS, serviceTabHref, type ServiceTab, type ServiceTabBadge } from './service-detail-tabs-model';
import { ServiceTabScroll } from './service-tab-scroll';
import styles from './jury.module.css';

export { parseServiceTab, serviceTabBadges, type ServiceTab } from './service-detail-tabs-model';

const TONE: Record<ServiceTabBadge['tone'], string> = {
  ok: styles.serviceTabBadgeOk,
  warn: styles.serviceTabBadgeWarn,
  muted: styles.serviceTabBadgeMuted,
};

export function ServiceTabNav({
  connectionId,
  active,
  badges = {},
}: {
  connectionId: string;
  active: ServiceTab;
  badges?: Partial<Record<ServiceTab, ServiceTabBadge>>;
}) {
  const id = `service-tabs-${connectionId}`;
  return (
    <nav className={styles.serviceTabBar} aria-label="서비스 영역">
      <div id={id} className={styles.serviceTabs} role="tablist" aria-label="서비스 영역">
        {SERVICE_TABS.map((t) => {
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
              className={selected ? `${styles.serviceTab} ${styles.serviceTabActive}` : styles.serviceTab}
            >
              <span>{t.label}</span>
              {badge ? <span className={`${styles.serviceTabBadge} ${TONE[badge.tone]}`}>{badge.text}</span> : null}
            </Link>
          );
        })}
      </div>
      <ServiceTabScroll containerId={id} active={active} />
    </nav>
  );
}
