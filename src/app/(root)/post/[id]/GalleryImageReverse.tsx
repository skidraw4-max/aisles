import Link from 'next/link';
import styles from './post.module.css';
import {
  FileText,
  Frame,
  Hash,
  ImageIcon,
  Layers,
  Lock,
  Palette,
  Sparkles,
  SunMedium,
} from 'lucide-react';
import { analyzeImageForGalleryPost } from '@/app/actions/gemini';
import { pickEstimatedPromptFromAnalysis } from '@/lib/gallery-image-analysis';
import { computePromptSyncPercent, promptSyncFunLabel } from '@/lib/prompt-sync-score';
import { GalleryEstimatedPromptCopyButton } from './GalleryEstimatedPromptCopyButton';

type SectionProps = {
  postId: string;
  imageUrl: string;
  authorOriginalPrompt: string;
};

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v);
}

function pickText(data: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const t = str(data[k]);
    if (t) return t;
  }
  return '';
}

function pickKeywords(data: Record<string, unknown>): string[] {
  const raw = data.keywords ?? data.주요키워드 ?? data.keywordList;
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
  }
  return [];
}

function GalleryImageReverseCards({
  data,
  omitEstimatedPromptCard,
}: {
  data: Record<string, unknown>;
  omitEstimatedPromptCard?: boolean;
}) {
  const estimatedPrompt = omitEstimatedPromptCard
    ? ''
    : pickText(data, [
        'estimatedPrompt',
        '추정프롬프트',
        'estimated_prompt',
        'prompt',
        '프롬프트',
      ]);
  const artStyle = pickText(data, ['artStyle', '화풍', 'style', '스타일']);
  const lighting = pickText(data, ['lighting', '조명']);
  const composition = pickText(data, ['composition', '구도']);
  const keywords = pickKeywords(data);

  const usedKeys = new Set([
    'estimatedPrompt',
    '추정프롬프트',
    'estimated_prompt',
    'prompt',
    '프롬프트',
    'artStyle',
    '화풍',
    'style',
    '스타일',
    'lighting',
    '조명',
    'composition',
    '구도',
    'keywords',
    '주요키워드',
    'keywordList',
  ]);
  const extraEntries = Object.entries(data).filter(([k, v]) => {
    if (usedKeys.has(k)) return false;
    if (v == null) return false;
    if (typeof v === 'object') return false;
    return String(v).trim().length > 0;
  });

  return (
    <div className="space-y-6">
      <h3 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
        분석 결과
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {estimatedPrompt ? (
          <article className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-2)] p-5 shadow-lg shadow-black/20 transition hover:border-[var(--accent)]/25 sm:col-span-2">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                  aria-hidden
                >
                  <Sparkles className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                    추정 프롬프트
                  </h4>
                  <p className="text-[length:var(--type-12)] text-[var(--muted)]">모델이 추론한 생성 지시문</p>
                </div>
              </div>
              <div className="flex shrink-0 justify-end sm:pt-0.5">
                <GalleryEstimatedPromptCopyButton text={estimatedPrompt} />
              </div>
            </div>
            <p
              className="whitespace-pre-wrap leading-relaxed text-[var(--muted)]"
              style={{ fontSize: 'var(--type-15)' }}
            >
              {estimatedPrompt}
            </p>
          </article>
        ) : null}

        {artStyle ? (
          <article className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-2)] p-5 shadow-lg shadow-black/20 transition hover:border-[var(--accent)]/25">
            <div className="mb-4 flex items-start gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                aria-hidden
              >
                <Palette className="h-5 w-5" strokeWidth={2} />
              </div>
              <div>
                <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                  화풍·스타일
                </h4>
                <p className="text-[length:var(--type-12)] text-[var(--muted)]">미디엄·톤·참고 양식</p>
              </div>
            </div>
            <p
              className="whitespace-pre-wrap leading-relaxed text-[var(--muted)]"
              style={{ fontSize: 'var(--type-15)' }}
            >
              {artStyle}
            </p>
          </article>
        ) : null}

        {lighting ? (
          <article className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-2)] p-5 shadow-lg shadow-black/20 transition hover:border-[var(--accent)]/25">
            <div className="mb-4 flex items-start gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                aria-hidden
              >
                <SunMedium className="h-5 w-5" strokeWidth={2} />
              </div>
              <div>
                <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                  조명
                </h4>
                <p className="text-[length:var(--type-12)] text-[var(--muted)]">광질·방향·분위기</p>
              </div>
            </div>
            <p
              className="whitespace-pre-wrap leading-relaxed text-[var(--muted)]"
              style={{ fontSize: 'var(--type-15)' }}
            >
              {lighting}
            </p>
          </article>
        ) : null}

        {composition ? (
          <article className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-2)] p-5 shadow-lg shadow-black/20 transition hover:border-[var(--accent)]/25">
            <div className="mb-4 flex items-start gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                aria-hidden
              >
                <Frame className="h-5 w-5" strokeWidth={2} />
              </div>
              <div>
                <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                  구도
                </h4>
                <p className="text-[length:var(--type-12)] text-[var(--muted)]">프레이밍·앵글·리듬</p>
              </div>
            </div>
            <p
              className="whitespace-pre-wrap leading-relaxed text-[var(--muted)]"
              style={{ fontSize: 'var(--type-15)' }}
            >
              {composition}
            </p>
          </article>
        ) : null}

        {keywords.length > 0 ? (
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
                  주요 키워드
                </h4>
                <p className="text-[length:var(--type-12)] text-[var(--muted)]">검색·프롬프트 확장에 활용</p>
              </div>
            </div>
            <ul className="flex flex-wrap gap-2">
              {keywords.map((kw) => (
                <li key={kw}>
                  <span className="inline-flex rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[length:var(--type-13)] text-[var(--text)]">
                    {kw}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ) : null}

        {extraEntries.length > 0 ? (
          <article className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-2)] p-5 shadow-lg shadow-black/20 sm:col-span-2">
            <div className="mb-4 flex items-start gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                aria-hidden
              >
                <Layers className="h-5 w-5" strokeWidth={2} />
              </div>
              <div>
                <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                  추가 필드
                </h4>
                <p className="text-[length:var(--type-12)] text-[var(--muted)]">모델이 반환한 기타 항목</p>
              </div>
            </div>
            <dl className="space-y-2 text-[length:var(--type-14)] text-[var(--muted)]">
              {extraEntries.map(([k, v]) => (
                <div key={k}>
                  <dt className="font-semibold text-[var(--text)]">{k}</dt>
                  <dd className="whitespace-pre-wrap pl-0">{str(v)}</dd>
                </div>
              ))}
            </dl>
          </article>
        ) : null}
      </div>
    </div>
  );
}

function GalleryImageReverseCompareBlock({
  authorOriginalPrompt,
  aiReversePrompt,
}: {
  authorOriginalPrompt: string;
  aiReversePrompt: string;
}) {
  const score = computePromptSyncPercent(authorOriginalPrompt, aiReversePrompt);
  const fun = promptSyncFunLabel(score);
  const leftLabel = authorOriginalPrompt.trim() ? authorOriginalPrompt : '등록된 원본 프롬프트가 없습니다.';
  const rightLabel = aiReversePrompt.trim() ? aiReversePrompt : '—';

  return (
    <>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-2)] p-5 shadow-lg shadow-black/20">
          <div className="mb-3 flex items-start gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
              aria-hidden
            >
              <FileText className="h-5 w-5" strokeWidth={2} />
            </div>
            <div>
              <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                게시자 원본 프롬프트
              </h4>
              <p className="text-[length:var(--type-12)] text-[var(--muted)]">메타데이터·본문에서 가져온 텍스트</p>
            </div>
          </div>
          <p
            className="whitespace-pre-wrap leading-relaxed text-[var(--muted)]"
            style={{ fontSize: 'var(--type-15)' }}
          >
            {leftLabel}
          </p>
        </article>
        <article className="rounded-2xl border border-[var(--accent)]/30 bg-gradient-to-br from-[var(--surface)] via-[var(--surface-2)] to-[var(--accent-soft)]/40 p-5 shadow-lg shadow-black/20">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                aria-hidden
              >
                <Sparkles className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <h4 className="font-semibold text-[var(--text)]" style={{ fontSize: 'var(--type-17)' }}>
                  AI 역분석 추정 프롬프트
                </h4>
                <p className="text-[length:var(--type-12)] text-[var(--muted)]">이미지를 보고 모델이 추론한 지시문</p>
              </div>
            </div>
            <div className="flex shrink-0 justify-end sm:pt-0.5">
              <GalleryEstimatedPromptCopyButton text={aiReversePrompt} />
            </div>
          </div>
          <p
            className="whitespace-pre-wrap leading-relaxed text-[var(--muted)]"
            style={{ fontSize: 'var(--type-15)' }}
          >
            {rightLabel}
          </p>
        </article>
      </div>

      <article
        className="mb-6 overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-r from-violet-950/40 via-fuchsia-950/25 to-cyan-950/35 p-5 shadow-lg shadow-black/25 sm:p-6"
        aria-labelledby="gallery-sync-score-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 font-medium text-[var(--accent)]" style={{ fontSize: 'var(--type-13)' }}>
              AI 싱크로율
            </p>
            <h3
              id="gallery-sync-score-heading"
              className="font-semibold tracking-tight text-[var(--text)]"
              style={{ fontSize: 'var(--type-20)' }}
            >
              두 프롬프트가 얼마나 닮았을까?
            </h3>
            <p className="mt-1 text-[length:var(--type-13)] text-[var(--muted)]">
              단어 겹침·순서를 바탕으로 한 가벼운 유사도입니다. 재미로 봐 주세요.
            </p>
          </div>
          <div className="text-right">
            <p className="text-[length:var(--type-14)] text-[var(--muted)]">
              <span className="mr-1.5" aria-hidden>
                {fun.emoji}
              </span>
              {fun.label}
            </p>
            <p
              className="font-bold tabular-nums tracking-tight text-[var(--accent)]"
              style={{ fontSize: 'clamp(2rem, 5vw, 2.75rem)' }}
            >
              {score}
              <span className="text-[length:var(--type-18)] font-semibold text-[var(--muted)]">%</span>
            </p>
          </div>
        </div>
        <div
          className="mt-4 h-3 w-full overflow-hidden rounded-full bg-[var(--bg)]/80"
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`AI 싱크로율 ${score}퍼센트`}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 transition-[width] duration-500 ease-out"
            style={{ width: `${score}%` }}
          />
        </div>
      </article>
    </>
  );
}

/** DB에 캐시된 역분석 — Gemini 호출 없음 */
export function GalleryImageReverseFromDb({
  authorOriginalPrompt,
  aiReversePrompt,
  aiImageAnalysis,
}: {
  authorOriginalPrompt: string;
  aiReversePrompt: string;
  aiImageAnalysis: Record<string, unknown> | null;
}) {
  const data =
    aiImageAnalysis != null && typeof aiImageAnalysis === 'object' && !Array.isArray(aiImageAnalysis)
      ? aiImageAnalysis
      : {};

  return (
    <section
      className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--surface)]/75 p-5 shadow-xl shadow-black/20 backdrop-blur-sm sm:p-8"
      aria-labelledby="gallery-reverse-heading"
    >
      <header className="mb-6">
        <p className="mb-1 font-medium text-[var(--accent)]" style={{ fontSize: 'var(--type-13)' }}>
          Image intelligence
        </p>
        <h2
          id="gallery-reverse-heading"
          className="font-semibold tracking-tight text-[var(--text)]"
          style={{ fontSize: 'var(--type-22)' }}
        >
          AI 이미지 역분석
        </h2>
        <p className="mt-2 max-w-xl text-[var(--muted)]" style={{ fontSize: 'var(--type-14)' }}>
          저장된 분석 결과를 불러왔습니다. 새로 분석하려면 나중에 다시 시도할 수 있어요.
        </p>
      </header>

      <GalleryImageReverseCompareBlock
        authorOriginalPrompt={authorOriginalPrompt}
        aiReversePrompt={aiReversePrompt}
      />
      <GalleryImageReverseCards data={data} omitEstimatedPromptCard />
    </section>
  );
}

/** Suspense fallback — 갤러리 AI 역분석 로딩 */
export function GalleryImageReverseFallback() {
  return (
    <section
      className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--surface)]/75 p-6 shadow-xl shadow-black/20 backdrop-blur-sm sm:p-8"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="mb-5 flex items-center gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]"
          aria-hidden
        >
          <ImageIcon className="h-6 w-6 animate-pulse" strokeWidth={2} />
        </div>
        <div>
          <p className="font-medium text-[var(--accent)]" style={{ fontSize: 'var(--type-13)' }}>
            Image intelligence
          </p>
          <p className="font-semibold tracking-tight text-[var(--text)]" style={{ fontSize: 'var(--type-18)' }}>
            AI 이미지 역분석
          </p>
        </div>
      </div>
      <div
        className="flex min-h-[120px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--bg)]/80 px-6 py-10"
        style={{
          backgroundImage:
            'linear-gradient(120deg, rgba(124,58,237,0.08) 0%, rgba(6,182,212,0.06) 100%)',
        }}
      >
        <div className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className={styles.galleryReverseDot} />
          ))}
        </div>
        <p
          className="text-center font-medium text-[var(--text)]"
          style={{ fontSize: 'var(--type-16)' }}
        >
          AI가 이미지를 판독하고 있습니다...
        </p>
      </div>
    </section>
  );
}

/** 비로그인 시 — Suspense 없이 동기 렌더 (로딩 스피너 없음) */
export function GalleryImageReverseLoginShell({ loginNextPath }: { loginNextPath: string }) {
  const href = `/login?next=${encodeURIComponent(loginNextPath)}`;
  return (
    <section
      className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--surface)]/75 p-5 shadow-xl shadow-black/20 backdrop-blur-sm sm:p-8"
      aria-labelledby="gallery-reverse-heading"
    >
      <header className="mb-6">
        <p className="mb-1 font-medium text-[var(--accent)]" style={{ fontSize: 'var(--type-13)' }}>
          Image intelligence
        </p>
        <h2
          id="gallery-reverse-heading"
          className="font-semibold tracking-tight text-[var(--text)]"
          style={{ fontSize: 'var(--type-22)' }}
        >
          AI 이미지 역분석
        </h2>
      </header>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]/80 p-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--accent)]">
          <Lock className="h-7 w-7" strokeWidth={2} aria-hidden />
        </div>
        <p className="mb-4 font-medium text-[var(--text)]" style={{ fontSize: 'var(--type-15)' }}>
          AI 이미지 역분석은 로그인한 회원만 이용할 수 있습니다.
        </p>
        <Link
          href={href}
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
    </section>
  );
}

/**
 * 갤러리 대표 이미지로 서버에서 역분석 후 DB 저장 — 부모에서 Suspense로 로딩 UI 제공.
 */
export async function GalleryImageReverseSection({
  postId,
  imageUrl,
  authorOriginalPrompt,
}: SectionProps) {
  const res = await analyzeImageForGalleryPost(postId, { imageUrl });
  const aiEstimated = res.ok ? pickEstimatedPromptFromAnalysis(res.data) : '';

  return (
    <section
      className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--surface)]/75 p-5 shadow-xl shadow-black/20 backdrop-blur-sm sm:p-8"
      aria-labelledby="gallery-reverse-heading"
    >
      <header className="mb-6">
        <p className="mb-1 font-medium text-[var(--accent)]" style={{ fontSize: 'var(--type-13)' }}>
          Image intelligence
        </p>
        <h2
          id="gallery-reverse-heading"
          className="font-semibold tracking-tight text-[var(--text)]"
          style={{ fontSize: 'var(--type-22)' }}
        >
          AI 이미지 역분석
        </h2>
        <p className="mt-2 max-w-xl text-[var(--muted)]" style={{ fontSize: 'var(--type-14)' }}>
          대표 이미지를 기준으로 추정 프롬프트·화풍·조명·구도·키워드를 JSON으로 해석합니다. (Gemini)
        </p>
      </header>

      {!res.ok ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-500/35 bg-red-950/35 px-5 py-4 text-[length:var(--type-15)] text-red-100"
        >
          {res.error}
        </div>
      ) : (
        <>
          <GalleryImageReverseCompareBlock
            authorOriginalPrompt={authorOriginalPrompt}
            aiReversePrompt={aiEstimated}
          />
          <GalleryImageReverseCards data={res.data} omitEstimatedPromptCard />
        </>
      )}
    </section>
  );
}
