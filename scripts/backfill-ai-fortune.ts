/**
 * AI FORTUNE 주차 백필
 *
 * 필요 env: DATABASE_URL(또는 DIRECT_URL), GOOGLE_GENERATIVE_AI_API_KEY 또는 GEMINI_API_KEY
 *
 * 실행:
 *   npx tsx scripts/backfill-ai-fortune.ts
 *   npx tsx scripts/backfill-ai-fortune.ts 2026-08-W5 2026-09-W2
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
loadEnv();

async function main() {
  const { AI_FORTUNE_BACKFILL_END_KEY, AI_FORTUNE_BACKFILL_START_KEY, parseAiFortuneWeekKey } =
    await import('../src/lib/ai-fortune/kst-week');
  const { runAiFortuneBackfill } = await import('../src/lib/ai-fortune/run-ai-fortune-backfill');

  const startArg = process.argv[2]?.trim();
  const endArg = process.argv[3]?.trim();
  const startKey =
    startArg && parseAiFortuneWeekKey(startArg) ? startArg : AI_FORTUNE_BACKFILL_START_KEY;
  const endKey = endArg && parseAiFortuneWeekKey(endArg) ? endArg : AI_FORTUNE_BACKFILL_END_KEY;

  console.log('[backfill-ai-fortune] range', { startKey, endKey });
  const result = await runAiFortuneBackfill(startKey, endKey);
  console.log('[backfill-ai-fortune] 완료', JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error('[backfill-ai-fortune] 실패', e);
  process.exit(1);
});
