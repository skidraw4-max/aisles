import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { ProfileForm } from './ProfileForm';
import styles from './profile.module.css';

export const metadata = {
  title: '프로필 — AIsle',
};

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect('/');
  }

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { username: true, avatarUrl: true },
  });

  const metaName = user.user_metadata?.username as string | undefined;
  const emailLocal = user.email.split('@')[0] ?? '';
  const initialUsername =
    row?.username ?? (metaName?.trim() || emailLocal || 'user');

  return (
    <>
      <SiteHeader />
      <main className={styles.main}>
        <div className={styles.wrap}>
          <nav className={styles.breadcrumb} aria-label="경로">
            <Link href="/">홈</Link>
            <span aria-hidden>/</span>
            <span>프로필</span>
          </nav>
          <h1 className={styles.title}>프로필 설정</h1>
          <ProfileForm
            initialUsername={initialUsername}
            initialAvatarUrl={row?.avatarUrl ?? null}
            email={user.email}
          />
        </div>
      </main>
    </>
  );
}
