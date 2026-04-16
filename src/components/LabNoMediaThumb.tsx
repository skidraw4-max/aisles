'use client';

import styles from '@/app/(root)/page.module.css';

export type LabNoMediaThumbKind = 'visual' | 'marketing';

type Props = {
  kind: LabNoMediaThumbKind;
  /** ALL 카드: `.feedCardMedia` 안에서 이미지와 동일하게 전체 덮음 */
  layout?: 'card' | 'compact';
};

/**
 * LAB 게시글만 — 대표 미디어 없을 때 썸네일 자리(민트·파랑 / 주황·분홍 그라데이션).
 */
export function LabNoMediaThumb({ kind, layout = 'compact' }: Props) {
  const grad =
    kind === 'marketing'
      ? 'bg-gradient-to-br from-orange-400 to-rose-500'
      : 'bg-gradient-to-br from-teal-400 to-sky-500';

  const sizeClass = layout === 'card' ? styles.labNoMediaThumbCard : 'h-full w-full min-h-0';

  return (
    <div
      className={`${grad} ${sizeClass} flex items-center justify-center rounded-lg text-2xl font-bold text-white shadow-sm transition-transform duration-200 ease-out hover:scale-[1.03] hover:brightness-110 hover:shadow-md`}
      aria-hidden
    >
      {kind === 'marketing' ? (
        <span className="select-none drop-shadow-md" aria-hidden>
          📢
        </span>
      ) : (
        <span className="select-none drop-shadow-md">L</span>
      )}
    </div>
  );
}
