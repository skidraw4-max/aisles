import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteFooter } from '@/components/SiteFooter';
import { getViewerIsAdmin } from '@/lib/auth/require-admin';
import { fetchLaunchPostsForAdmin } from '@/lib/ugc-hub';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import { LaunchBannersAdminClient } from './LaunchBannersAdminClient';
import styles from './launch-banners-admin.module.css';

export const metadata: Metadata = {
  title: 'LAUNCH 배너 관리 — AIsle',
  robots: SEO_ROBOTS_PRIVATE,
};

export default async function LaunchBannersAdminPage() {
  const isAdmin = await getViewerIsAdmin();
  if (!isAdmin) {
    redirect('/');
  }

  const { active, candidates } = await fetchLaunchPostsForAdmin();

  return (
    <>
      <main className={styles.main}>
        <LaunchBannersAdminClient active={active} candidates={candidates} />
      </main>
      <SiteFooter />
    </>
  );
}
