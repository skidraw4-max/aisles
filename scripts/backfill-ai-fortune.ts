/**
 * AI FORTUNE 주차 백필 (2026-04-W1 ~ 2026-05-W2 기본)
 *
 * 필요 env: DATABASE_URL(또는 DIRECT_URL), GOOGLE_GENERATIVE_AI_API_KEY 또는 GEMINI_API_KEY
 *
 * 실행:
 *   npx tsx scripts/backfill-ai-fortune.ts
 *
 * 프로덕션 API (대안, CRON_SECRET 필요):
 *   curl -X POST "https://<host>/api/cron/ai-fortune?backfill=true" -H "Authorization: Bearer $CRON_SECRET"
 */
import 'dotenv/config';
import { runAiFortuneBackfill } from '../src/lib/ai-fortune/run-ai-fortune-backfill';

async function main() {
  const result = await runAiFortuneBackfill();
  console.log('[backfill-ai-fortune] 완료', JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error('[backfill-ai-fortune] 실패', e);
  process.exit(1);
});
