import { SiteHeader } from '@/components/SiteHeader';
import { NoticeBar } from '@/components/NoticeBar';
import { UiLabelsProvider } from '@/components/UiLabelsProvider';
import { getRollingNoticesForBar } from '@/app/notices/actions';
import { getAllUiLabels } from '@/lib/ui-config';

export default async function RootShellLayout({ children }: { children: React.ReactNode }) {
  const notices = await getRollingNoticesForBar();
  const uiLabels = await getAllUiLabels();

  return (
    <UiLabelsProvider labels={uiLabels}>
      <SiteHeader />
      <NoticeBar notices={notices} />
      {children}
    </UiLabelsProvider>
  );
}
