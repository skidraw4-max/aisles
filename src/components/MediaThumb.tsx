import type { CSSProperties } from 'react';
import Image from 'next/image';
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
  /**
   * LCP: next/image `priority` — lazy 로딩 비활성화·preload (이미지 URL일 때만 적용).
   */
  priority?: boolean;
  /** `priority`일 때 next/image `sizes` (레이아웃별 힌트) */
  sizes?: string;
};

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

const DEFAULT_CARD_SIZES = '(max-width: 479px) 100vw, (max-width: 959px) 50vw, 25vw';

/** R2 등 URL이 이미지/영상인지 확장자로 구분해 표시 */
export function MediaThumb({
  url,
  alt,
  className,
  objectFit = 'cover',
  objectPosition = 'center bottom',
  videoControls = false,
  intrinsic = false,
  priority = false,
  sizes,
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
        preload={priority ? 'auto' : 'metadata'}
        aria-label={alt}
      />
    );
  }

  const useNextImage = priority && !intrinsic;
  if (useNextImage) {
    return (
      <Image
        src={url}
        alt={alt}
        fill
        className={cn}
        style={fit}
        sizes={sizes ?? DEFAULT_CARD_SIZES}
        priority
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element -- 비우선 로드·임의 호스트 폴백
  return <img className={cn} style={fit} src={url} alt={alt} loading="lazy" decoding="async" />;
}
