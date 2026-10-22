'use client';

import Image from 'next/image';
import styles from './post.module.css';

const AVATAR_SIZES = '44px';

type Props = {
  src: string;
  alt: string;
};

/** 게시글 작성자 아바타 — next/image (R2·Supabase 원격) */
export function PostAuthorAvatar({ src, alt }: Props) {
  return (
    <div className={styles.authorAvatar}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={AVATAR_SIZES}
        className={styles.authorAvatarImg}
      />
    </div>
  );
}
