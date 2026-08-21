'use client';

import Link from 'next/link';
import { sendGAEvent } from '@/lib/ga4';
import styles from './ugc-corridor-cross-promo.module.css';

type Variant = 'homeAll' | 'build' | 'launch' | 'postBuild' | 'postLaunch';

type Props = {
  variant: Variant;
};

const COPY: Record<
  Variant,
  { title: string; body: string; primary: { href: string; label: string; event: string }; secondary: { href: string; label: string; event: string } }
> = {
  homeAll: {
    title: '이번 주 UGC 루프',
    body: '인기 레시피를 보고, 출시작을 알리거나 직접 올려 보세요.',
    primary: { href: '/?category=BUILD', label: '주간 BUILD 보기', event: 'ugc_cross_home_build' },
    secondary: { href: '/upload?category=LAUNCH', label: 'LAUNCH 등록', event: 'ugc_cross_home_launch_upload' },
  },
  build: {
    title: '레시피 올렸다면 출시도',
    body: 'BUILD에서 검증한 아이디어를 LAUNCH 보드에 소개해 보세요.',
    primary: { href: '/upload?category=LAUNCH', label: 'LAUNCH 등록하기', event: 'ugc_cross_build_launch_upload' },
    secondary: { href: '/?category=LAUNCH', label: '출시 보드 보기', event: 'ugc_cross_build_launch_feed' },
  },
  launch: {
    title: '출시 전에 레시피 공유',
    body: '제작 과정을 BUILD에 남기면 이번 주 베스트에 노출될 수 있어요.',
    primary: { href: '/upload?category=BUILD', label: '레시피 등록하기', event: 'ugc_cross_launch_build_upload' },
    secondary: { href: '/?category=BUILD', label: 'BUILD 주간 베스트', event: 'ugc_cross_launch_build_feed' },
  },
  postBuild: {
    title: '다음 스텝: 출시 알리기',
    body: '이 레시피로 만든 서비스를 LAUNCH에 올려 보세요.',
    primary: { href: '/upload?category=LAUNCH', label: 'LAUNCH에 등록', event: 'ugc_cross_post_build_launch' },
    secondary: { href: '/?category=LAUNCH', label: '출시 보드', event: 'ugc_cross_post_build_launch_feed' },
  },
  postLaunch: {
    title: '제작기도 남겨 두기',
    body: '런칭 스토리의 레시피를 BUILD에 공유하면 더 많은 메이커가 배웁니다.',
    primary: { href: '/upload?category=BUILD', label: 'BUILD에 등록', event: 'ugc_cross_post_launch_build' },
    secondary: { href: '/?category=BUILD', label: '제작기 보드', event: 'ugc_cross_post_launch_build_feed' },
  },
};

/** BUILD ↔ LAUNCH 주간 루프 교차 CTA (피드·상세 공통) */
export function UgcCorridorCrossPromo({ variant }: Props) {
  const c = COPY[variant];
  return (
    <aside className={styles.wrap} aria-label={c.title}>
      <div className={styles.text}>
        <p className={styles.title}>{c.title}</p>
        <p className={styles.body}>{c.body}</p>
      </div>
      <div className={styles.actions}>
        <Link
          href={c.primary.href}
          className={styles.primary}
          onClick={() => sendGAEvent(c.primary.event)}
        >
          {c.primary.label}
        </Link>
        <Link
          href={c.secondary.href}
          className={styles.secondary}
          onClick={() => sendGAEvent(c.secondary.event)}
        >
          {c.secondary.label}
        </Link>
      </div>
    </aside>
  );
}
