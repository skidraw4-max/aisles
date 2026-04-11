import type { CSSProperties } from 'react';
import styles from '@/app/page.module.css';

type Props = {
  url: string;
  alt: string;
  className?: string;
  /** 기본 cover — 상세 등에서 contain 사용 */
  objectFit?: 'cover' | 'contain';
  /**
   * cover일 때 크롭 기준점. 기본 center bottom — 하단 워터마크가 4:3·16:10 썸네일에서 잘리지 않도록.
   */
  objectPosition?: string;
  /** 영상 재생 컨트롤 (기본 false — 카드 썸네일용) */
  videoControls?: boolean;
  /** true: 고정 박스 대신 width 100%·height auto로 전체 미디어 표시 (상세 전용) */
  intrinsic?: boolean;
};

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

/** R2 등 URL이 이미지/영상인지 확장자로 구분해 표시 */
export function MediaThumb({
  url,
  alt,
  className,
  objectFit = 'cover',
  objectPosition = 'center bottom',
  videoControls = false,
  intrinsic = false,
}: Props) {
  const base = intrinsic ? styles.mediaFillIntrinsic : styles.mediaFill;
  const cn = [base, className].filter(Boolean).join(' ');
  const fit: CSSProperties = { objectFit, objectPosition };
  if (isVideoUrl(url)) {
    return (
      <video
        className={cn}
        style={fit}
        src={url}
        muted
        playsInline
        controls={videoControls}
        preload="metadata"
        aria-label={alt}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- 외부 R2 URL
  return <img className={cn} style={fit} src={url} alt={alt} />;
}
