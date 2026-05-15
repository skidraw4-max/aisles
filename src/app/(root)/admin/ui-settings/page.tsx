import type { Metadata } from 'next';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import { redirect } from 'next/navigation';
import { SiteFooter } from '@/components/SiteFooter';
import { getViewerIsAdmin } from '@/lib/auth/require-admin';
import { getAllUiLabels } from '@/lib/ui-config';
import { UI_CONFIG_SEED } from '@/lib/ui-config-defaults';
import { UiSettingsClient, type UiSettingsRow } from './UiSettingsClient';

export const metadata: Metadata = {
  title: 'UI 문구 설정 — AIsle',
  robots: SEO_ROBOTS_PRIVATE,
};

export default async function AdminUiSettingsPage() {
  const isAdmin = await getViewerIsAdmin();
  if (!isAdmin) {
    redirect('/');
  }

  const merged = await getAllUiLabels();

  const rows: UiSettingsRow[] = UI_CONFIG_SEED.map((seed) => ({
    key: seed.key,
    value: merged[seed.key] ?? seed.value,
    description: seed.description,
  }));

  return (
    <>
      <UiSettingsClient rows={rows} />
      <SiteFooter />
    </>
  );
}
