/**
 * I-051: service detail page areas. Tabs are plain links driven by ?tab= so the page stays a server component.
 */
import Link from 'next/link';
import { SERVICE_TABS, serviceTabHref, type ServiceTab } from './service-detail-tabs-model';
import styles from './jury.module.css';

export { parseServiceTab, type ServiceTab } from './service-detail-tabs-model';

export function ServiceTabNav({ connectionId, active }: { connectionId: string; active: ServiceTab }) {
  return (
    <nav className={`${styles.tabs} ${styles.serviceTabs}`} aria-label="서비스 영역">
      {SERVICE_TABS.map((t) => (
        <Link
          key={t.key}
          href={serviceTabHref(connectionId, t.key)}
          className={t.key === active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          aria-current={t.key === active ? 'page' : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
