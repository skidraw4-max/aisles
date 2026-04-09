import type { CSSProperties } from 'react';
import styles from '@/app/page.module.css';

type Props = {
  url: string;
  alt: string;
  className?: string;
  /** 기본 cover — 상세 등에서 contain 사용 */
  objectFit?: 'cover' | 'contain';
  /** 영상 재생 컨트롤 (기본 false — 카드 썸네일용) */
  videoControls?: boolean;
};

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

/** R2 등 URL이 이미지/영상인지 확장자로 구분해 표시 */
export function MediaThumb({ url, alt, className, objectFit = 'cover', videoControls = false }: Props) {
  const cn = [styles.mediaFill, className].filter(Boolean).join(' ');
  const fit: CSSProperties = { objectFit };
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
