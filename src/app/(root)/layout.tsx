import { Suspense } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { NoticeBar } from '@/components/NoticeBar';
import { SessionProvider } from '@/components/SessionProvider';
import { UiLabelsProvider } from '@/components/UiLabelsProvider';
import { getRollingNoticesForBar } from '@/app/notices/actions';
import { getAllUiLabels } from '@/lib/ui-config';
import { defaultUiLabelMap } from '@/lib/ui-config-defaults';
import { fetchLatestAiFortunePost } from '@/lib/ai-fortune/latest-fortune.server';
import { RetentionWelcomeToast } from '@/components/RetentionWelcomeToast';
import { KakaoAdFitLoader } from '@/components/KakaoAdFitLoader';

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

async function NoticeBarSlot() {
  const notices = await getRollingNoticesForBar();
  return <NoticeBar notices={notices} />;
}

async function WelcomeToastSlot() {
  const latestFortune = await safeLatestFortune();
  return <RetentionWelcomeToast latestFortunePostId={latestFortune?.id ?? null} />;
}

/**
 * Auth는 레이아웃에서 cookies()/getUser 하지 않는다.
 * cookies()는 Next 15에서 트리 전체를 dynamic으로 만들어 home/post ISR을 무력화한다.
 * 헤더 로그인 UI는 SessionProvider 클라이언트 세션으로 하이드레이트한다.
 */
export default async function RootShellLayout({ children }: { children: React.ReactNode }) {
  const uiLabels = await safeUiLabels();

  return (
    <SessionProvider>
      <UiLabelsProvider labels={uiLabels}>
        <SiteHeader />
        <Suspense fallback={null}>
          <NoticeBarSlot />
        </Suspense>
        {children}
        <KakaoAdFitLoader />
        <Suspense fallback={null}>
          <WelcomeToastSlot />
        </Suspense>
      </UiLabelsProvider>
    </SessionProvider>
  );
}
