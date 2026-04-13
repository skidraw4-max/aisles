import { SiteHeader } from '@/components/SiteHeader';
import { NoticeBar } from '@/components/NoticeBar';
import { getRollingNoticesForBar } from '@/app/notices/actions';

export default async function RootShellLayout({ children }: { children: React.ReactNode }) {
  const notices = await getRollingNoticesForBar();

  return (
    <>
      <SiteHeader />
      <NoticeBar notices={notices} />
      {children}
    </>
  );
}
