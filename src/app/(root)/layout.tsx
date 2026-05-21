import { SiteHeader } from '@/components/SiteHeader';
import { NoticeBar } from '@/components/NoticeBar';
import { SessionProvider } from '@/components/SessionProvider';
import { UiLabelsProvider } from '@/components/UiLabelsProvider';
import { getRollingNoticesForBar } from '@/app/notices/actions';
import { getAllUiLabels } from '@/lib/ui-config';
import { getInitialSession } from '@/lib/auth-initial-session';
import { fetchLatestAiFortunePost } from '@/lib/ai-fortune/latest-fortune';
import { RetentionWelcomeToast } from '@/components/RetentionWelcomeToast';

export default async function RootShellLayout({ children }: { children: React.ReactNode }) {
  const [initialSession, notices, uiLabels, latestFortune] = await Promise.all([
    getInitialSession(),
    getRollingNoticesForBar(),
    getAllUiLabels(),
    fetchLatestAiFortunePost(),
  ]);

  return (
    <SessionProvider initialSession={initialSession}>
      <UiLabelsProvider labels={uiLabels}>
        <SiteHeader />
        <NoticeBar notices={notices} />
        {children}
        <RetentionWelcomeToast latestFortunePostId={latestFortune?.id ?? null} />
      </UiLabelsProvider>
    </SessionProvider>
  );
}
