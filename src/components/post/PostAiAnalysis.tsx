'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptAnalysisJobStatus } from '@prisma/client';
import Link from 'next/link';
import {
  BarChart3,
  Boxes,
  Frame,
  Hash,
  Layers,
  ListOrdered,
  Lock,
  Palette,
  Sparkles,
  SunMedium,
  Target,
} from 'lucide-react';
import { useAuth } from '@/components/SessionProvider';
import {
  analyzePostPromptAnalysis,
  type AnalyzePromptErrorCode,
  type PromptAnalysis,
} from '@/app/actions/gemini';
import { isMarketingAnalysis, isVisualAnalysis, type VisualPromptAnalysis } from '@/lib/prompt-analysis';

const ANALYSIS_CLIENT_TIMEOUT_MS = 15_000;
const POLL_FETCH_TIMEOUT_MS = 15_000;
const AUTO_ANALYSIS_MAX_WAIT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(label));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function SkeletonBar({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-md ${className}`}
      style={{
        animation: 'post-ai-skel 1.4s ease-in-out infinite',
        background:
          'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.04) 100%)',
        backgroundSize: '200% 100%',
      }}
    />
  );
}

function SkeletonCard() {
  return (
    <article
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-lg shadow-black/20"
      aria-hidden
    >
      <div className="mb-4 flex items-center gap-3">
        <SkeletonBar className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonBar className="h-3 w-28" />
          <SkeletonBar className="h-2 w-40" />
        </div>
      </div>
      <SkeletonBar className="mb-2 h-3 w-full" />
      <SkeletonBar className="mb-2 h-3 w-[92%]" />
      <SkeletonBar className="h-3 w-[78%]" />
    </article>
  );
}

const visualAnalysisCards: {
  key: keyof Pick<VisualPromptAnalysis, 'structure' | 'style' | 'lighting' | 'composition'>;
  title: string;
  subtitle: string;
  Icon: typeof Layers;
}[] = [
  { key: 'structure', title: '구조 분석', subtitle: '피사체·공간·디테일 계층', Icon: Layers },
  { key: 'style', title: '스타일 분석', subtitle: '미디엄·톤·팔레트', Icon: Palette },
  { key: 'lighting', title: '조명', subtitle: '광질·방향·분위기', Icon: SunMedium },
  { key: 'composition', title: '구도', subtitle: '프레이밍·앵글·리듬', Icon: Frame },
];

export type PostAiAnalysisProps = {
  postId: string;
  promptText: string;
  /** 서버에서 프롬프트 지문이 DB와 일치할 때만 전달 — 로드 시 Gemini 재호출 없음 */
  initialCachedAnalysis: PromptAnalysis | null;
  /** LAB 등록 후 자동 분석 작업 상태 (null = 레거시·수동만) */
  promptAnalysisJobStatus: PromptAnalysisJobStatus | null;
  isLoggedIn: boolean;
  /** 로그인 완료 후 돌아올 경로 (`/login?next=` — LoginClient와 동일) */
  loginNextPath: string;
};

export function PostAiAnalysis({
  postId,
  promptText,
  initialCachedAnalysis,
  promptAnalysisJobStatus,
  isLoggedIn,
  loginNextPath,
}: PostAiAnalysisProps) {
  const { isAuthenticated } = useAuth();
  /** 서버(RSC)와 클라이언트 세션 둘 다 true일 때만 분석 허용 — 로그아웃 직후 RSC prop이 늦게 갱신되는 경우 방지 */
  const canUseAiAnalysis = Boolean(isLoggedIn) && isAuthenticated;

  const trimmed = typeof promptText === 'string' ? promptText.trim() : '';
  const [result, setResult] = useState<PromptAnalysis | null>(initialCachedAnalysis);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<AnalyzePromptErrorCode | null>(null);
  const [serverNotice, setServerNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number | null>(null);

  const loginHref = `/login?next=${encodeURIComponent(loginNextPath)}`;

  useEffect(() => {
    if (!canUseAiAnalysis) {
      setResult(null);
      setError(null);
      setErrorCode(null);
      setServerNotice(null);
      return;
    }
    setResult(initialCachedAnalysis);
    setError(null);
    setErrorCode(null);
    setServerNotice(null);
  }, [canUseAiAnalysis, postId, initialCachedAnalysis]);

  useEffect(() => {
    if (!canUseAiAnalysis) return;
    if (promptAnalysisJobStatus !== 'PENDING') return;
    if (initialCachedAnalysis != null) return;

    let cancelled = false;
    pollDeadlineRef.current = Date.now() + AUTO_ANALYSIS_MAX_WAIT_MS;

    const clearPoll = () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      pollDeadlineRef.current = null;
    };

    const tick = async () => {
      if (cancelled) return;
      if (pollDeadlineRef.current != null && Date.now() > pollDeadlineRef.current) {
        setError(
          '자동 분석 응답이 지연되고 있습니다. 잠시 후 새로고침하거나 아래에서 다시 시도해 주세요.'
        );
        setErrorCode('API_ERROR');
        clearPoll();
        return;
      }
      const ac = new AbortController();
      const abortTimer = setTimeout(() => ac.abort(), POLL_FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`/api/posts/${postId}/prompt-analysis-status`, {
          signal: ac.signal,
        });
        clearTimeout(abortTimer);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          promptAnalysisStatus: PromptAnalysisJobStatus | null;
          analysis: PromptAnalysis | null;
        };
        if (cancelled) return;
        if (data.analysis) {
          setResult(data.analysis);
          setError(null);
          setErrorCode(null);
          clearPoll();
          return;
        }
        if (data.promptAnalysisStatus === 'FAILED') {
          setError('자동 분석을 완료하지 못했습니다. 아래 버튼으로 다시 시도해 주세요.');
          setErrorCode('API_ERROR');
          clearPoll();
        }
      } catch (e) {
        clearTimeout(abortTimer);
        if (cancelled) return;
        const isAbort = e instanceof DOMException && e.name === 'AbortError';
        if (isAbort) {
          setError('요청 시간이 초과되었습니다');
          setErrorCode('TIMEOUT');
          clearPoll();
          return;
        }
        /* 그 외 네트워크 오류는 다음 폴링에서 재시도 */
      }
    };

    void tick();
    pollIntervalRef.current = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearPoll();
    };
  }, [canUseAiAnalysis, postId, promptAnalysisJobStatus, initialCachedAnalysis]);

  const runAnalyze = useCallback(() => {
    const p = trimmed;
    if (!p || !canUseAiAnalysis) return;
    setError(null);
    setErrorCode(null);
    setServerNotice(null);
    setIsLoading(true);
    void (async () => {
      try {
        const res = await withTimeout(
          analyzePostPromptAnalysis(postId, p),
          ANALYSIS_CLIENT_TIMEOUT_MS,
          'CLIENT_TIMEOUT',
        );
        if (res.ok) {
          setResult(res.data);
          setError(null);
          setErrorCode(null);
          setServerNotice(typeof res.notice === 'string' && res.notice.trim() ? res.notice.trim() : null);
        } else {
          setResult(null);
          setError(res.error);
          setErrorCode(res.code);
          setServerNotice(null);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg === 'CLIENT_TIMEOUT') {
          setError('요청 시간이 초과되었습니다');
          setErrorCode('TIMEOUT');
        } else {
          setError(e instanceof Error ? e.message : '요청 처리 중 오류가 발생했습니다.');
          setErrorCode('API_ERROR');
        }
        setResult(null);
        setServerNotice(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [canUseAiAnalysis, postId, trimmed]);

  const waitingAutoJob =
    canUseAiAnalysis &&
    promptAnalysisJobStatus === 'PENDING' &&
    !result &&
    !error;

  const showPrimaryCta =
    canUseAiAnalysis &&
    !result &&
    !isLoading &&
    !error &&
    promptAnalysisJobStatus !== 'PENDING';

  if (!trimmed) {
    return null;
  }

  return (
    <>
      <style jsx global>{`
        @keyframes post-ai-skel {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
        @keyframes post-ai-glow {
          0%,
          100% {
            opacity: 0.55;
            transform: scale(1);
          }
          50% {
            opacity: 0.9;
            transform: scale(1.03);
          }
        }
      `}</style>

      <section
        className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--surface)]/75 p-5 shadow-xl shadow-black/20 backdrop-blur-sm sm:p-8"
        aria-labelledby="post-ai-analysis-heading"
      >
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 font-medium text-[var(--accent)]" style={{ fontSize: 'var(--type-13)' }}>
              Prompt intelligence
            </p>
            <h2
              id="post-ai-analysis-heading"
              className="font-semibold tracking-tight text-[var(--text)]"
              style={{ fontSize: 'var(--type-22)' }}
            >
              {result && isMarketingAnalysis(result) ? (
                <span className="mr-1.5 inline-block align-middle" aria-hidden title="마케팅·카피 분석">
                  📢
                </span>
              ) : null}
              프롬프트 AI 해석
            </h2>
            <p className="mt-2 max-w-xl text-[var(--muted)]" style={{ fontSize: 'var(--type-14)' }}>
              {canUseAiAnalysis ? (
                <>
                  이미지 생성용·마케팅/글쓰기용 프롬프트를 자동으로 구분해 분석합니다. 새 글은 등록 직후 서버에서 자동
                  분석하며, 한 번 저장된 분석은 DB에서만 읽어 옵니다(동일 글·동일 프롬프트에 Gemini 재호출 없음).
                </>
              ) : (
                <>로그인한 회원만 AI 분석을 실행할 수 있습니다. 로그인하면 이 레시피의 프롬프트를 바로 해석해 드립니다.</>
              )}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            {showPrimaryCta ? (
              <button
                type="button"
                onClick={() => runAnalyze()}
                className="group relative inline-flex min-h-[48px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl px-7 font-semibold text-white shadow-lg transition sm:w-auto"
                style={{
                  background:
                    'linear-gradient(120deg, #7c3aed 0%, #a855f7 35%, #ec4899 65%, #06b6d4 100%)',
                  backgroundSize: '180% 100%',
                  boxShadow: '0 12px 40px -8px rgba(124, 58, 237, 0.55), 0 0 0 1px rgba(255,255,255,0.08) inset',
                }}
              >
                <span
                  className="pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100"
                  style={{
                    background:
                      'linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.25) 45%, transparent 70%)',
                    animation: 'post-ai-glow 2.8s ease-in-out infinite',
                  }}
                />
                <Sparkles className="relative h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
                <span className="relative">AI 분석 보기</span>
              </button>
            ) : null}
          </div>
        </div>

        {canUseAiAnalysis && error ? (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-red-500/35 bg-red-950/35 px-5 py-4 text-[length:var(--type-15)] text-red-100"
          >
            <p className="mb-0">{error}</p>
            {errorCode === 'UNAUTHENTICATED' ? (
              <p className="mt-3 mb-0">
                <Link
                  href={loginHref}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white/15 px-5 font-semibold text-white underline-offset-2 transition hover:bg-white/25 hover:underline"
                >
                  로그인
                </Link>
              </p>
            ) : (
              <p className="mt-3 mb-0">
                <button
                  type="button"
                  onClick={() => runAnalyze()}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white/15 px-5 font-semibold text-white underline-offset-2 transition hover:bg-white/25"
                >
                  다시 시도
                </button>
              </p>
            )}
          </div>
        ) : null}

        {canUseAiAnalysis && serverNotice ? (
          <div
            role="status"
            className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-950/25 px-5 py-4 text-[length:var(--type-14)] leading-relaxed text-amber-50"
          >
            {serverNotice}
          </div>
        ) : null}

        {!canUseAiAnalysis ? (
          <div className="relative mt-2 min-h-[280px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]/60">
            <div className="pointer-events-none select-none p-4 blur-md sm:p-6" aria-hidden>
              <div className="mb-4 flex gap-3">
                <div className="h-11 w-11 shrink-0 rounded-xl bg-[var(--accent-soft)]" />
                <div className="min-w-0 flex-1 space-y-2 pt-1">
                  <div className="h-4 w-32 rounded bg-[var(--border)]" />
                  <div className="h-3 w-48 rounded bg-[var(--border)]" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-28 rounded-xl border border-[var(--border)] bg-[var(--surface)]/80" />
                ))}
              </div>
            </div>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--bg)]/75 px-5 py-8 text-center backdrop-blur-sm"
              role="region"
              aria-label="AI 분석 로그인 필요"
            >
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--accent)] shadow-lg shadow-black/20"
                aria-hidden
              >
                <Lock className="h-7 w-7" strokeWidth={2} />
              </div>
              <p
                className="max-w-md font-medium leading-relaxed text-[var(--text)]"
                style={{ fontSize: 'var(--type-16)' }}
              >
                AI 분석은 로그인 후 이용 가능합니다. 지금 가입하고 프롬프트 레시피를 분석해보세요!
              </p>
              <Link
                href={loginHref}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-8 font-semibold text-white shadow-lg transition hover:opacity-95"
                style={{
                  background:
                    'linear-gradient(120deg, #7c3aed 0%, #a855f7 35%, #ec4899 65%, #06b6d4 100%)',
                  boxShadow: '0 12px 40px -8px rgba(124, 58, 237, 0.55), 0 0 0 1px rgba(255,255,255,0.08) inset',
                }}
              >
                로그인
              </Link>
            </div>
          </div>
        ) : null}

        {canUseAiAnalysis && (waitingAutoJob || isLoading) ? (
          <div className="space-y-6" aria-busy="true" aria-live="polite">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p
                className="flex items-center gap-2 font-medium text-[var(--text)]"
                style={{ fontSize: 'var(--type-17)' }}
              >
                <Boxes className="h-5 w-5 animate-pulse text-[var(--accent)]" aria-hidden />
                {waitingAutoJob
                  ? '등록 직후 자동 분석을 진행 중입니다…'
                  : 'AI가 프롬프트를 해부하는 중입니다…'}
              </p>
              <span className="text-[length:var(--type-13)] text-[var(--muted)]">잠시만 기다려 주세요</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </div>
        ) : null}

        {canUseAiAnalysis && !isLoading && result && isVisualAnalysis(result) ? (
          <div className="space-y-6">
            <h3 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
              분석 결과
            </h3>
            <p className="mb-1 text-[length:var(--type-13)] text-[var(--muted)]">
              본문은 한국어로 생성됩니다. 분석 결과는 이 글에 대해 DB에 저장된 내용을 표시합니다.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {visualAnalysisCards.map(({ key, title, subtitle, Icon }) => (
                <article
                  key={key}
                  className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-2)] p-5 shadow-lg shadow-black/20 transition hover:border-[var(--accent)]/25"
                >
                  <div className="mb-4 flex items-start gap-3">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                      aria-hidden
                    >
                      <Icon className="h-5 w-5" strokeWidth={2} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                        {title}
                      </h4>
                      <p className="text-[length:var(--type-12)] text-[var(--muted)]">{subtitle}</p>
                    </div>
                  </div>
                  <p
                    className="whitespace-pre-wrap leading-relaxed text-[var(--muted)]"
                    style={{ fontSize: 'var(--type-15)' }}
                  >
                    {result[key]}
                  </p>
                </article>
              ))}

              <article className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-2)] p-5 shadow-lg shadow-black/20 sm:col-span-2">
                <div className="mb-4 flex items-start gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                    aria-hidden
                  >
                    <Hash className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                      추천 키워드
                    </h4>
                    <p className="text-[length:var(--type-12)] text-[var(--muted)]">검색·프롬프트 확장에 활용</p>
                  </div>
                </div>
                <ul className="flex flex-wrap gap-2">
                  {result.recommendedKeywords.map((kw: string, i: number) => (
                    <li key={`${i}-${kw}`}>
                      <span className="inline-flex rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[length:var(--type-13)] text-[var(--text)]">
                        {kw}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </div>
        ) : null}

        {canUseAiAnalysis && !isLoading && result && isMarketingAnalysis(result) ? (
          <div className="space-y-6">
            <h3 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
              분석 결과
            </h3>
            <p className="mb-1 text-[length:var(--type-13)] text-[var(--muted)]">
              마케팅·카피 관점의 타겟, 설득력, 대안 문구입니다. 본문은 한국어로 생성됩니다.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <article className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-2)] p-5 shadow-lg shadow-black/20 transition hover:border-[var(--accent)]/25">
                <div className="mb-4 flex items-start gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                    aria-hidden
                  >
                    <Target className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                      타겟 분석
                    </h4>
                    <p className="text-[length:var(--type-12)] text-[var(--muted)]">어조·타겟팅·메시지 방향</p>
                  </div>
                </div>
                <p
                  className="whitespace-pre-wrap leading-relaxed text-[var(--muted)]"
                  style={{ fontSize: 'var(--type-15)' }}
                >
                  {result.targetAnalysis}
                </p>
              </article>

              <article className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-2)] p-5 shadow-lg shadow-black/20 transition hover:border-[var(--accent)]/25">
                <div className="mb-4 flex items-start gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                    aria-hidden
                  >
                    <BarChart3 className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                      설득력 점수
                    </h4>
                    <p className="text-[length:var(--type-12)] text-[var(--muted)]">전환·클릭 유도 가능성</p>
                  </div>
                </div>
                <p
                  className="whitespace-pre-wrap leading-relaxed text-[var(--muted)]"
                  style={{ fontSize: 'var(--type-15)' }}
                >
                  {result.persuasionScore}
                </p>
              </article>

              <article className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-2)] p-5 shadow-lg shadow-black/20 sm:col-span-2">
                <div className="mb-4 flex items-start gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                    aria-hidden
                  >
                    <ListOrdered className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                      대안 문구 3가지
                    </h4>
                    <p className="text-[length:var(--type-12)] text-[var(--muted)]">클릭·공유에 쓸 수 있는 변형</p>
                  </div>
                </div>
                <ol className="list-decimal space-y-3 pl-5 text-[var(--muted)]" style={{ fontSize: 'var(--type-15)' }}>
                  {result.alternativePhrases.map((line, idx) => (
                    <li key={idx} className="leading-relaxed">
                      <span className="text-[var(--text)]">{line}</span>
                    </li>
                  ))}
                </ol>
              </article>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
