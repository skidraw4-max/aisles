import { MediaThumb } from '@/components/MediaThumb';
import styles from './post.module.css';

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

type Props = {
  url: string | null;
  alt: string;
  /** 메인 컬럼용(매거진 레이아웃) — 히어로 높이를 줄입니다 */
  compact?: boolean;
};

export function GalleryPostMedia({ url, alt, compact }: Props) {
  const stageClass = compact ? `${styles.galleryStage} ${styles.galleryStageMagazine}` : styles.galleryStage;

  if (!url) {
    return (
      <figure className={stageClass} aria-label={alt}>
        <div className={styles.galleryBackdrop} aria-hidden>
          <div className={styles.galleryBackdropFallback} />
        </div>
        <div className={styles.galleryVignette} aria-hidden />
        <div className={styles.galleryGlassOuter}>
          <div className={styles.galleryGlassInner}>
            <div className={styles.galleryEmptyInner} role="img" aria-label="미디어 없음" />
          </div>
        </div>
      </figure>
    );
  }

  const video = isVideoUrl(url);

  return (
    <figure className={stageClass} aria-label={alt}>
      <div className={styles.galleryBackdrop} aria-hidden>
        {video ? (
          <video
            className={styles.galleryBackdropMedia}
            src={url}
            muted
            playsInline
            loop
            autoPlay
            preload="metadata"
            aria-hidden
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- 외부 R2 URL
          <img className={styles.galleryBackdropMedia} src={url} alt="" />
        )}
      </div>
      <div className={styles.galleryVignette} aria-hidden />
      <div className={styles.galleryGlassOuter}>
        <div className={styles.galleryGlassInner}>
          <MediaThumb url={url} alt={alt} objectFit="contain" videoControls />
        </div>
      </div>
    </figure>
  );
}
