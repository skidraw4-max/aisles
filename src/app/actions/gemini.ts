'use server';

import { unstable_noStore as noStore } from 'next/cache';

/**
 * Gemini: `@google/generative-ai` — package.json 기준 최신 안내는 npm `0.24.1` (프로젝트와 동일한지 배포 시 확인).
 * 모델: Google AI Studio 할당량 기준 **Gemini 2.5 Flash** → API ID `gemini-2.5-flash`.
 * 연결만 검증하려면 `GEMINI_MINIMAL_SYSTEM=1` → 시스템 문구가 "너는 도우미야." 로 바뀜(기본은 정교한 분석 프롬프트).
 *
 * 스트리밍 UI는 `POST /api/posts/[id]/prompt-analysis-stream` + `@/lib/gemini-prompt-analysis-engine`.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { fingerprintPrompt } from '@/lib/prompt-analysis-fingerprint';
import {
  executeGeminiPromptAnalysisWithApiKey,
  GEMINI_API_KEY_ENV_NAMES,
  logGeminiKeyEnvDiagnostics,
  missingApiKeyResult,
  readGeminiApiKeyFromEnv,
  validateGeminiApiKeyShape,
  type AnalyzePromptErrorCode,
  type AnalyzePromptResult,
  type PromptAnalysis,
} from '@/lib/gemini-prompt-analysis-engine';
import { parseStoredPromptAnalysisJson } from '@/lib/prompt-analysis';

export type { PromptAnalysis, AnalyzePromptErrorCode, AnalyzePromptResult };

async function loadCachedPromptAnalysisForPost(
  postId: string,
  expectedHash: string,
): Promise<PromptAnalysis | null> {
  const row = await prisma.aiMetadata.findUnique({
    where: { postId },
    select: { promptAnalysis: true, promptAnalysisPromptHash: true },
  });
  if (row?.promptAnalysisPromptHash !== expectedHash || row.promptAnalysis == null) {
    return null;
  }
  return parseStoredPromptAnalysisJson(row.promptAnalysis);
}

async function requireUserForPromptAnalysis(): Promise<{ ok: true } | { ok: false }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false };
  return { ok: true };
}

/**
 * Gemini만 호출(캐시·세션 검증 없음). 서버 액션·백그라운드 작업에서 공통 사용.
 * @param trimmed — 공백 제거된 비빈 문자열
 */
export async function executeGeminiPromptAnalysis(trimmed: string): Promise<AnalyzePromptResult> {
  const resolved = readGeminiApiKeyFromEnv();
  if (!resolved.ok) {
    console.error(
      '[executeGeminiPromptAnalysis] Missing API Key (server). Checked env names:',
      GEMINI_API_KEY_ENV_NAMES.join(', '),
    );
    logGeminiKeyEnvDiagnostics();
    return missingApiKeyResult();
  }

  const apiKey = resolved.key;

  const keyCheck = validateGeminiApiKeyShape(apiKey);
  if (!keyCheck.ok) {
    return { ok: false, error: keyCheck.message, code: 'INVALID_API_KEY' };
  }

  if (process.env.NODE_ENV === 'development') {
    console.info(
      `[executeGeminiPromptAnalysis] API key OK (length=${apiKey.length}, from=${resolved.source}), model="gemini-2.5-flash", minimalSystem=${process.env.GEMINI_MINIMAL_SYSTEM === '1'}`,
    );
  }

  return executeGeminiPromptAnalysisWithApiKey(trimmed, apiKey);
}

/**
 * Gemini만 호출(캐시 없음). 모델은 문자열 리터럴 `"gemini-2.5-flash"` 고정 (대시보드 텍스트 출력·Gemini 2.5 Flash).
 */
export async function analyzePrompt(userPrompt: string): Promise<AnalyzePromptResult> {
  noStore();

  const trimmed = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  if (!trimmed) {
    return {
      ok: false,
      error: '분석할 프롬프트를 입력해 주세요.',
      code: 'EMPTY_PROMPT',
    };
  }

  const auth = await requireUserForPromptAnalysis();
  if (!auth.ok) {
    return {
      ok: false,
      error: 'AI 분석은 로그인한 회원만 이용할 수 있습니다.',
      code: 'UNAUTHENTICATED',
    };
  }

  return executeGeminiPromptAnalysis(trimmed);
}

/**
 * 레시피 상세용: DB에 동일 프롬프트 해시의 분석이 있으면 **항상** DB만 사용하고 Gemini를 호출하지 않음(비용·중복 방지).
 */
export async function analyzePostPromptAnalysis(
  postId: string,
  promptText: string,
): Promise<AnalyzePromptResult> {
  noStore();

  const trimmed = typeof promptText === 'string' ? promptText.trim() : '';
  const logPrefix = `[analyzePostPromptAnalysis] postId=${postId}`;
  console.log(`${logPrefix} invoked`, {
    promptLength: trimmed.length,
  });

  if (!trimmed) {
    console.log(`${logPrefix} abort EMPTY_PROMPT`);
    return {
      ok: false,
      error: '분석할 프롬프트를 입력해 주세요.',
      code: 'EMPTY_PROMPT',
    };
  }

  const auth = await requireUserForPromptAnalysis();
  if (!auth.ok) {
    console.log(`${logPrefix} abort UNAUTHENTICATED`);
    return {
      ok: false,
      error: 'AI 분석은 로그인한 회원만 이용할 수 있습니다.',
      code: 'UNAUTHENTICATED',
    };
  }

  const hash = fingerprintPrompt(trimmed);

  try {
    const cached = await loadCachedPromptAnalysisForPost(postId, hash);
    if (cached) {
      console.log(`${logPrefix} cache hit (no Gemini)`, { hashPrefix: hash.slice(0, 12) });
      return { ok: true, data: cached };
    }

    const keyResolved = readGeminiApiKeyFromEnv();
    if (!keyResolved.ok) {
      const stale = await loadCachedPromptAnalysisForPost(postId, hash);
      if (stale) {
        console.warn(
          `${logPrefix} Gemini API key missing; returning DB cache only`,
        );
        return {
          ok: true,
          data: stale,
          notice:
            '서버에 Gemini API 키가 설정되어 있지 않아 원격으로 새로 분석하지 못했습니다. 이전에 저장된 분석 결과를 그대로 보여 드립니다. 새 분석을 받으려면 호스팅 환경 변수에 GOOGLE_GENERATIVE_AI_API_KEY(또는 GEMINI_API_KEY)를 넣고 재배포해 주세요.',
        };
      }
      console.error(
        '[analyzePostPromptAnalysis] Missing API Key (server). Checked env names:',
        GEMINI_API_KEY_ENV_NAMES.join(', '),
      );
      logGeminiKeyEnvDiagnostics();
      return missingApiKeyResult();
    }

    const res = await executeGeminiPromptAnalysis(trimmed);
    if (!res.ok) {
      console.log(`${logPrefix} executeGemini finished`, { ok: false, code: res.code });
      return res;
    }

    await prisma.aiMetadata.upsert({
      where: { postId },
      create: {
        postId,
        promptAnalysis: res.data as object,
        promptAnalysisPromptHash: hash,
        promptAnalysisStatus: 'READY',
      },
      update: {
        promptAnalysis: res.data as object,
        promptAnalysisPromptHash: hash,
        promptAnalysisStatus: 'READY',
      },
    });

    console.log(`${logPrefix} success persisted`, { hashPrefix: hash.slice(0, 12) });
    return res;
  } catch (e) {
    console.error(`${logPrefix} unexpected error`, e);
    return {
      ok: false,
      error: '프롬프트 분석 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      code: 'API_ERROR',
    };
  }
}

/**
 * LAB 글 등록 직후 백그라운드 실행: DB에 동일 해시 분석이 이미 있으면 Gemini를 호출하지 않음.
 */
export async function runPostPromptAnalysisJob(postId: string, promptText: string): Promise<void> {
  const trimmed = typeof promptText === 'string' ? promptText.trim() : '';
  console.log('[runPostPromptAnalysisJob] start', { postId, promptLength: trimmed.length });
  if (!trimmed) {
    try {
      await prisma.aiMetadata.update({
        where: { postId },
        data: {
          promptAnalysisStatus: 'FAILED',
          promptAnalysis: Prisma.DbNull,
          promptAnalysisPromptHash: null,
        },
      });
    } catch (e) {
      console.error('[runPostPromptAnalysisJob] empty prompt, metadata update failed', postId, e);
    }
    return;
  }

  const hash = fingerprintPrompt(trimmed);
  const cached = await loadCachedPromptAnalysisForPost(postId, hash);
  if (cached) {
    console.log('[runPostPromptAnalysisJob] skip Gemini: already in DB', {
      postId,
      hashPrefix: hash.slice(0, 12),
    });
    try {
      await prisma.aiMetadata.update({
        where: { postId },
        data: { promptAnalysisStatus: 'READY' },
      });
    } catch (e) {
      console.error('[runPostPromptAnalysisJob] READY status-only update failed', postId, e);
    }
    return;
  }

  const res = await executeGeminiPromptAnalysis(trimmed);

  if (!res.ok) {
    console.warn('[runPostPromptAnalysisJob] Gemini failed', { postId, code: res.code });
    try {
      await prisma.aiMetadata.update({
        where: { postId },
        data: {
          promptAnalysisStatus: 'FAILED',
          promptAnalysis: Prisma.DbNull,
          promptAnalysisPromptHash: null,
        },
      });
    } catch (e) {
      console.error('[runPostPromptAnalysisJob] FAILED update failed', postId, e);
    }
    return;
  }

  try {
    await prisma.aiMetadata.update({
      where: { postId },
      data: {
        promptAnalysis: res.data as object,
        promptAnalysisPromptHash: hash,
        promptAnalysisStatus: 'READY',
      },
    });
    console.log('[runPostPromptAnalysisJob] success', { postId, hashPrefix: hash.slice(0, 12) });
  } catch (e) {
    console.error('[runPostPromptAnalysisJob] READY update failed', postId, e);
  }
}
