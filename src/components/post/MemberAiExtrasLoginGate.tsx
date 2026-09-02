'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { AuthModal } from '@/components/AuthModal';
import { trackGalleryReverseLoginClick } from '@/lib/ga4';

export type MemberAiExtrasLoginGateProps = {
  loginNextPath: string;
  headingId: string;
  eyebrow: string;
  title: string;
  description: string;
  /** GA4 `gallery_reverse_login_click` 등 */
  postId?: string;
  analyticsEvent?: 'gallery_reverse_login_click';
};

/**
 * 게시글 내 회원 전용 AI 영역 — 비로그인 시 본문 대신 CTA.
 * `SiteHeader`와 동일하게 `AuthModal` + 전체 화면 로그인 링크를 제공합니다.
 */
export function MemberAiExtrasLoginGate({
  loginNextPath,
  headingId,
  eyebrow,
  title,
  description,
  postId,
  analyticsEvent,
}: MemberAiExtrasLoginGateProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const loginHref = `/login?next=${encodeURIComponent(loginNextPath)}`;

  const trackLoginIntent = () => {
    if (analyticsEvent === 'gallery_reverse_login_click' && postId) {
      trackGalleryReverseLoginClick(postId);
    }
  };

  return (
    <>
      <section
        className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--surface)]/75 p-5 shadow-xl shadow-black/20 backdrop-blur-sm sm:p-8"
        aria-labelledby={headingId}
      >
        <header className="mb-6">
          <p className="mb-1 font-medium text-[var(--accent)]" style={{ fontSize: 'var(--type-13)' }}>
            {eyebrow}
          </p>
          <h2
            id={headingId}
            className="font-semibold tracking-tight text-[var(--text)]"
            style={{ fontSize: 'var(--type-22)' }}
          >
            {title}
          </h2>
        </header>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]/80 p-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--accent)]">
            <Lock className="h-7 w-7" strokeWidth={2} aria-hidden />
          </div>
          <p className="mb-4 font-medium text-[var(--text)]" style={{ fontSize: 'var(--type-15)' }}>
            {description}
          </p>
          <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:justify-center">
            <button
              type="button"
              onClick={() => {
                trackLoginIntent();
                setModalOpen(true);
              }}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-8 font-semibold text-white shadow-lg transition hover:opacity-95"
              style={{
                background:
                  'linear-gradient(120deg, #7c3aed 0%, #a855f7 35%, #ec4899 65%, #06b6d4 100%)',
                boxShadow: '0 12px 40px -8px rgba(124, 58, 237, 0.55), 0 0 0 1px rgba(255,255,255,0.08) inset',
              }}
            >
              로그인 · 가입
            </button>
            <Link
              href={loginHref}
              onClick={() => trackLoginIntent()}
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 font-semibold text-[var(--text)] transition hover:bg-[var(--surface-2)]"
            >
              로그인 페이지
            </Link>
          </div>
        </div>
      </section>
      <AuthModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAuthed={() => {
          setModalOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
