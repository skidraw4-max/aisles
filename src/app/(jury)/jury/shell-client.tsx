'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ClipboardCheck, FileSearch, House, Layers, type LucideIcon, ScrollText, Settings, Wrench } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { juryHref } from '@/lib/jury-product/jury-url';
import { PRODUCT_NAV } from '@/lib/jury-product/product-nav';
import styles from './jury.module.css';

/** I-085: one lucide icon per product nav item, keyed by label. */
const NAV_ICONS: Record<(typeof PRODUCT_NAV)[number]['label'], LucideIcon> = {
  홈: House,
  '심사 요청': FileSearch,
  결과: ClipboardCheck,
  서비스: Layers,
  개선: Wrench,
  '감사 이력': ScrollText,
  관리: Settings,
};
import { buttonClass } from './jury-controls';

export function ProductNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <nav className={styles.navWrap} aria-label="Jury">
      <button
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls="jury-nav"
        onClick={() => setOpen((value) => !value)}
      >
        메뉴
      </button>
      <ul id="jury-nav" className={open ? `${styles.nav} ${styles.navOpen}` : styles.nav}>
        {PRODUCT_NAV.map((item) => {
          const dashboard = PRODUCT_NAV[0].href;
          const Icon = NAV_ICONS[item.label];
          const active = item.href === dashboard ? pathname === dashboard : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={active ? styles.navActive : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon size={16} aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function OnboardingSubmit({
  label,
  pendingLabel,
  name,
  value,
}: {
  label: string;
  pendingLabel: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={buttonClass('secondary')} type="submit" name={name} value={value} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className={buttonClass('secondary')}
      onClick={async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.replace(juryHref('/'));
        router.refresh();
      }}
    >
      로그아웃
    </button>
  );
}
