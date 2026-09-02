import Link from 'next/link';
import styles from './post.module.css';

type Props = {
  postId?: string;
};

/** GALLERY 상세 — 갤러리 허브·업로드(로그인) CTA */
export function GalleryReversePromoCta({ postId: _postId }: Props) {
  const uploadNext = `/login?next=${encodeURIComponent('/upload?category=GALLERY')}`;

  return (
    <aside className={styles.galleryReversePromo} aria-label="AI 이미지 역분석 더 보기">
      <p className={styles.galleryReversePromoLead}>
        다른 AI 이미지의 프롬프트·스타일을 더 보거나, 내 이미지를 올려 역분석할 수 있습니다.
      </p>
      <div className={styles.galleryReversePromoActions}>
        <Link href="/?category=GALLERY" className={styles.galleryReversePromoPrimary}>
          갤러리에서 예시 더 보기
        </Link>
        <Link href={uploadNext} className={styles.galleryReversePromoSecondary}>
          내 이미지 분석하기
        </Link>
      </div>
      <p className={styles.galleryReversePromoHint}>
        분석·업로드는 로그인 후 이용할 수 있습니다. 이 글의 저장된 분석 결과는 공유 링크로도 볼 수
        있습니다.
      </p>
    </aside>
  );
}
