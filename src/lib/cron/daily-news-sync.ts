import { runGeekNewsSync, type GeekNewsSyncResult } from '@/lib/geeknews/run-geeknews-sync';
import { runHackerNewsSync, type HackerNewsSyncResult } from '@/lib/hackernews/run-hackernews-sync';
import { runVergeSync, type VergeSyncResult } from '@/lib/verge/run-verge-sync';

export type DailyNewsSyncBundledResult = {
  verge: VergeSyncResult | { thrown: unknown };
  geeknews: GeekNewsSyncResult | { thrown: unknown };
  hackernews: HackerNewsSyncResult | { thrown: unknown };
};

/**
 * The Verge → GeekNews → Hacker News 순으로 실행.
 * 한 단계가 실패하거나 예외여도 다음 소스는 계속 시도한다.
 */
export async function runDailyNewsSyncBundled(options: {
  force: boolean;
}): Promise<DailyNewsSyncBundledResult> {
  const { force } = options;

  let verge: VergeSyncResult | { thrown: unknown };
  try {
    verge = await runVergeSync({ force });
    if (!verge.ok) {
      console.error('[daily-news] The Verge 단계 실패 — GeekNews로 계속', {
        step: verge.step,
        message: verge.message,
      });
    }
  } catch (e) {
    console.error('[daily-news] The Verge 동기화 예외 — GeekNews로 계속', e);
    verge = { thrown: e };
  }

  let geeknews: GeekNewsSyncResult | { thrown: unknown };
  try {
    geeknews = await runGeekNewsSync({ force });
    if (!geeknews.ok) {
      console.error('[daily-news] GeekNews 단계 실패 — Hacker News로 계속', {
        step: geeknews.step,
        message: geeknews.message,
      });
    }
  } catch (e) {
    console.error('[daily-news] GeekNews 동기화 예외 — Hacker News로 계속', e);
    geeknews = { thrown: e };
  }

  let hackernews: HackerNewsSyncResult | { thrown: unknown };
  try {
    hackernews = await runHackerNewsSync({ force });
    if (!hackernews.ok) {
      console.error('[daily-news] Hacker News 단계 실패', {
        step: hackernews.step,
        message: hackernews.message,
      });
    }
  } catch (e) {
    console.error('[daily-news] Hacker News 동기화 예외', e);
    hackernews = { thrown: e };
  }

  return { verge, geeknews, hackernews };
}
