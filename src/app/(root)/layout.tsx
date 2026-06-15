import { SiteHeader } from '@/components/SiteHeader';
import { NoticeBar } from '@/components/NoticeBar';
import { SessionProvider } from '@/components/SessionProvider';
import { UiLabelsProvider } from '@/components/UiLabelsProvider';
import { getRollingNoticesForBar } from '@/app/notices/actions';
import { getAllUiLabels } from '@/lib/ui-config';
import { defaultUiLabelMap } from '@/lib/ui-config-defaults';
import { getInitialSession } from '@/lib/auth-initial-session';
import { fetchLatestAiFortunePost } from '@/lib/ai-fortune/latest-fortune.server';
import { RetentionWelcomeToast } from '@/components/RetentionWelcomeToast';

async function safeUiLabels(): Promise<Record<string, string>> {
  try {
    return await getAllUiLabels();
  } catch (e) {
    console.error('[RootShellLayout] getAllUiLabels fallback', e);
    return defaultUiLabelMap();
  }
}

async function safeLatestFortune() {
  try {
    return await fetchLatestAiFortunePost();
  } catch (e) {
    console.error('[RootShellLayout] fetchLatestAiFortunePost fallback', e);
    return null;
  }
}

export default async function RootShellLayout({ children }: { children: React.ReactNode }) {
  const [initialSession, notices, uiLabels, latestFortune] = await Promise.all([
    getInitialSession(),
    getRollingNoticesForBar(),
    safeUiLabels(),
    safeLatestFortune(),
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
