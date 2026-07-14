/**
 * AI FORTUNE — 영어 trendBullets(「이번 주 AI 흐름」)를 한국어로 재번역·DB 갱신
 *
 * 필요 env: DATABASE_URL 또는 DIRECT_URL, GOOGLE_GENERATIVE_AI_API_KEY (또는 GEMINI_*)
 *
 * 실행:
 *   npx tsx scripts/retranslate-ai-fortune-trends-ko.ts
 *   npx tsx scripts/retranslate-ai-fortune-trends-ko.ts --week=2026-07-W2
 *   npx tsx scripts/retranslate-ai-fortune-trends-ko.ts --dry-run
 */
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: false });

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Prisma } from '@prisma/client';
import { GEMINI_API_VERSION_CHAIN, GEMINI_GEEKNEWS_MODEL_CHAIN } from '../src/lib/gemini-models';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  readGeminiApiKeyFromEnv,
  tryParseJsonFromModelText,
} from '../src/lib/gemini-prompt-analysis-engine';
import { looksPrimarilyEnglish } from '../src/lib/ai-fortune/korean-text';
import {
  aiFortunePayloadFromDb,
  parseAiFortuneWeeklyPayload,
  type AiFortuneWeeklyPayload,
} from '../src/lib/ai-fortune/payload';
import { formatAiFortunePostBody } from '../src/lib/ai-fortune/format-fortune-body';

const SYSTEM = `너는 한국어 테크 에디터다. 입력은 AI FORTUNE의 영어 trendBullets다.
각 항목을 **의미·고유명사·수치를 유지한 채 자연스러운 한국어**로 번역한다.
제품명·회사명·모델명은 원문 표기를 유지한다.
반드시 JSON만 출력: {"trendBullets":["...","..."]} — 배열 길이·순서는 입력과 동일.`;

function parseArgs(argv: string[]) {
  let week: string | null = null;
  let dryRun = false;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--week=')) week = a.slice('--week='.length).trim() || null;
  }
  return { week, dryRun };
}

async function translateTrends(
  apiKey: string,
  englishTrends: string[],
): Promise<{ ok: true; trends: string[] } | { ok: false; error: string }> {
  const user = `다음 trendBullets를 한국어로 번역하세요.\n${JSON.stringify({ trendBullets: englishTrends }, null, 2)}`;

  let lastErr: unknown;
  for (const modelId of GEMINI_GEEKNEWS_MODEL_CHAIN) {
    for (const apiVersion of GEMINI_API_VERSION_CHAIN) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel(
          {
            model: modelId,
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
            },
            systemInstruction: SYSTEM,
          },
          { apiVersion },
        );
        const result = await model.generateContent(user);
        const parsed = tryParseJsonFromModelText(result.response.text());
        if (!parsed.ok) continue;
        const raw = parsed.value as { trendBullets?: unknown };
        if (!Array.isArray(raw.trendBullets)) continue;
        const trends = raw.trendBullets
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 15)
          .map((t) => t.trim());
        if (trends.length !== englishTrends.length) continue;
        if (trends.some((t) => looksPrimarilyEnglish(t))) {
          return { ok: false, error: '번역 결과가 여전히 영어 위주입니다' };
        }
        return { ok: true, trends };
      } catch (e) {
        lastErr = e;
        if (isGeminiModelNotFoundForFallback(e)) continue;
        const classified = classifyGeminiFailure(e);
        if (classified.category === 'RATE_LIMIT' || classified.category === 'SERVER') {
          return { ok: false, error: classified.userMessage };
        }
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'Gemini 실패');
  return { ok: false, error: msg };
}

async function main() {
  const { week, dryRun } = parseArgs(process.argv.slice(2));
  const keyRes = readGeminiApiKeyFromEnv();
  if (!keyRes.ok) {
    console.error('Gemini API key missing');
    process.exit(1);
  }

  // prisma는 DATABASE_URL을 모듈 로드 시점에 읽으므로 dotenv 이후 dynamic import
  const { prisma } = await import('../src/lib/prisma');

  const posts = await prisma.post.findMany({
    where: {
      category: 'AI_FORTUNE',
      ...(week ? { aiFortuneWeekKey: week } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      aiFortuneWeekKey: true,
      aiFortunePayload: true,
    },
    take: week ? 5 : 12,
  });

  let updated = 0;
  let skipped = 0;

  for (const post of posts) {
    const payload = aiFortunePayloadFromDb(post.aiFortunePayload);
    if (!payload) {
      console.warn('[skip] invalid payload', post.id, post.aiFortuneWeekKey);
      skipped++;
      continue;
    }

    const englishIdx = payload.trendBullets
      .map((t, i) => (looksPrimarilyEnglish(t) ? i : -1))
      .filter((i) => i >= 0);

    if (englishIdx.length === 0) {
      console.log('[ok] already Korean', post.aiFortuneWeekKey, post.id);
      skipped++;
      continue;
    }

    console.log(
      '[translate]',
      post.aiFortuneWeekKey,
      post.id,
      `englishTrends=${englishIdx.length}/${payload.trendBullets.length}`,
    );

    const tr = await translateTrends(keyRes.key, payload.trendBullets);
    if (!tr.ok) {
      console.error('[fail]', post.id, tr.error);
      process.exitCode = 1;
      continue;
    }

    const next: AiFortuneWeeklyPayload = {
      ...payload,
      trendBullets: tr.trends,
    };
    const validated = parseAiFortuneWeeklyPayload(next);
    if (!validated) {
      console.error('[fail] translated payload failed validation', post.id);
      process.exitCode = 1;
      continue;
    }

    const content = formatAiFortunePostBody(validated);
    if (dryRun) {
      console.log('[dry-run] would update', post.id);
      tr.trends.forEach((t, i) => console.log(`  [${i}] ${t.slice(0, 120)}`));
      continue;
    }

    await prisma.post.update({
      where: { id: post.id },
      data: {
        content,
        aiFortunePayload: validated as unknown as Prisma.InputJsonValue,
      },
    });
    console.log('[updated]', post.aiFortuneWeekKey, post.id);
    updated++;
  }

  console.log(JSON.stringify({ updated, skipped, dryRun, week }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
