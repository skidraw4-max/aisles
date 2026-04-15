'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Boxes,
  Frame,
  Hash,
  Layers,
  Lock,
  Palette,
  Sparkles,
  SunMedium,
} from 'lucide-react';
import { useAuth } from '@/components/SessionProvider';
import {
  analyzePostPromptAnalysis,
  type AnalyzePromptErrorCode,
  type PromptAnalysis,
} from '@/app/actions/gemini';

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

const analysisCards: {
  key: keyof Omit<PromptAnalysis, 'recommendedKeywords'>;
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
  /** 서버에서 프롬프트 지문이 DB와 일치할 때만 전달 — 로드 시 API 호출 없음 */
  initialCachedAnalysis: PromptAnalysis | null;
  isLoggedIn: boolean;
  /** 로그인 완료 후 돌아올 경로 (`/login?next=` — LoginClient와 동일) */
  loginNextPath: string;
};

export function PostAiAnalysis({
  postId,
  promptText,
  initialCachedAnalysis,
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
  const [isPending, startTransition] = useTransition();

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

  const runAnalyze = useCallback(
    (forceRefresh: boolean) => {
      const p = trimmed;
      if (!p || !canUseAiAnalysis) return;
      setError(null);
      setErrorCode(null);
      setServerNotice(null);
      startTransition(async () => {
        const res = await analyzePostPromptAnalysis(postId, p, { forceRefresh });
        if (res.ok) {
          setResult(res.data);
          setError(null);
          setErrorCode(null);
          setServerNotice(typeof res.notice === 'string' && res.notice.trim() ? res.notice.trim() : null);
        } else {
          if (!forceRefresh) {
            setResult(null);
          }
          setError(res.error);
          setErrorCode(res.code);
          setServerNotice(null);
        }
      });
    },
    [canUseAiAnalysis, postId, trimmed],
  );

  const showPrimaryCta = canUseAiAnalysis && !result && !isPending && !error;
  const showRefreshCta = canUseAiAnalysis && Boolean(result) && !isPending;

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
              프롬프트 AI 해석
            </h2>
            <p className="mt-2 max-w-xl text-[var(--muted)]" style={{ fontSize: 'var(--type-14)' }}>
              {canUseAiAnalysis ? (
                <>
                  위 레시피 프롬프트를 기준으로 구조·스타일·조명·구도와 추천 키워드를 정리합니다. 분석은 버튼을 눌렀을 때만
                  요청되며, 한 번 분석된 결과는 저장되어 다시 불러옵니다.
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
                onClick={() => runAnalyze(false)}
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
            {showRefreshCta ? (
              <button
                type="button"
                onClick={() => runAnalyze(true)}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[length:var(--type-13)] font-medium text-[var(--text)] transition hover:border-[var(--accent)]/40"
              >
                다시 분석
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
            ) : null}
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

        {canUseAiAnalysis && isPending ? (
          <div className="space-y-6" aria-busy="true" aria-live="polite">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p
                className="flex items-center gap-2 font-medium text-[var(--text)]"
                style={{ fontSize: 'var(--type-17)' }}
              >
                <Boxes className="h-5 w-5 animate-pulse text-[var(--accent)]" aria-hidden />
                AI가 프롬프트를 해부하는 중입니다…
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

        {canUseAiAnalysis && !isPending && result ? (
          <div className="space-y-6">
            <h3 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
              분석 결과
            </h3>
            <p className="mb-1 text-[length:var(--type-13)] text-[var(--muted)]">
              본문은 한국어로 생성됩니다. 이전에 저장된 영어 결과는 「다시 분석」으로 갱신할 수 있습니다.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {analysisCards.map(({ key, title, subtitle, Icon }) => (
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
                  {result.recommendedKeywords.map((kw, i) => (
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
      </section>
    </>
  );
}
