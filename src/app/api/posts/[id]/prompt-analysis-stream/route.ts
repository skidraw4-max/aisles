import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import {
  GEMINI_API_KEY_ENV_NAMES,
  logGeminiKeyEnvDiagnostics,
  missingApiKeyResult,
  readGeminiApiKeyFromEnv,
  streamGeminiPromptAnalysisWithApiKey,
  validateGeminiApiKeyShape,
  type AnalyzePromptResult,
} from '@/lib/gemini-prompt-analysis-engine';
import { fingerprintPrompt } from '@/lib/prompt-analysis-fingerprint';
import { parseStoredPromptAnalysisJson, type PromptAnalysis } from '@/lib/prompt-analysis';

type Ctx = { params: Promise<{ id: string }> };

function loadCachedPromptAnalysisForPost(
  postId: string,
  expectedHash: string,
): Promise<PromptAnalysis | null> {
  return (async () => {
    const row = await prisma.aiMetadata.findUnique({
      where: { postId },
      select: { promptAnalysis: true, promptAnalysisPromptHash: true },
    });
    if (row?.promptAnalysisPromptHash !== expectedHash || row.promptAnalysis == null) {
      return null;
    }
    return parseStoredPromptAnalysisJson(row.promptAnalysis);
  })();
}

/**
 * LAB 프롬프트 분석 — Gemini `generateContentStream` 결과를 NDJSON으로 스트리밍합니다.
 * 한 줄당 하나의 JSON 이벤트: `{type:'delta',text}` | `{type:'cached',data}` | `{type:'complete',...}`.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: postId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return Response.json(
      { ok: false, error: 'AI 분석은 로그인한 회원만 이용할 수 있습니다.', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: '잘못된 요청 본문입니다.', code: 'API_ERROR' }, { status: 400 });
  }

  const promptText =
    typeof body === 'object' &&
    body !== null &&
    'promptText' in body &&
    typeof (body as { promptText: unknown }).promptText === 'string'
      ? (body as { promptText: string }).promptText.trim()
      : '';

  if (!promptText) {
    return Response.json(
      { ok: false, error: '분석할 프롬프트를 입력해 주세요.', code: 'EMPTY_PROMPT' },
      { status: 400 },
    );
  }

  const hash = fingerprintPrompt(promptText);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const cached = await loadCachedPromptAnalysisForPost(postId, hash);
        if (cached) {
          send({ type: 'complete', ok: true, data: cached });
          controller.close();
          return;
        }

        const keyResolved = readGeminiApiKeyFromEnv();
        if (!keyResolved.ok) {
          const stale = await loadCachedPromptAnalysisForPost(postId, hash);
          if (stale) {
            send({
              type: 'complete',
              ok: true,
              data: stale,
              notice:
                '서버에 Gemini API 키가 설정되어 있지 않아 원격으로 새로 분석하지 못했습니다. 이전에 저장된 분석 결과를 그대로 보여 드립니다.',
            });
            controller.close();
            return;
          }
          console.error(
            '[prompt-analysis-stream] Missing API Key (server). Checked env names:',
            GEMINI_API_KEY_ENV_NAMES.join(', '),
          );
          logGeminiKeyEnvDiagnostics();
          const miss = missingApiKeyResult();
          if (!miss.ok) {
            send({ type: 'complete', ok: false, error: miss.error, code: miss.code });
          }
          controller.close();
          return;
        }

        const apiKey = keyResolved.key;
        const keyCheck = validateGeminiApiKeyShape(apiKey);
        if (!keyCheck.ok) {
          send({ type: 'complete', ok: false, error: keyCheck.message, code: 'INVALID_API_KEY' });
          controller.close();
          return;
        }

        const res: AnalyzePromptResult = await streamGeminiPromptAnalysisWithApiKey(
          promptText,
          apiKey,
          (delta) => {
            send({ type: 'delta', text: delta });
          },
        );

        if (!res.ok) {
          send({ type: 'complete', ok: false, error: res.error, code: res.code });
          controller.close();
          return;
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

        send({ type: 'complete', ok: true, data: res.data });
        controller.close();
      } catch (e) {
        console.error('[prompt-analysis-stream]', e);
        try {
          send({
            type: 'complete',
            ok: false,
            error: '프롬프트 분석 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
            code: 'API_ERROR',
          });
        } catch {
          /* ignore */
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
