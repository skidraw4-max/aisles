import { isTrustedMediaUrl } from '@/lib/r2-url';
import { isVideoUrl } from '@/lib/post-media-urls';

type Segment =
  | { type: 'text'; value: string }
  | { type: 'embed'; alt: string; url: string; raw: string };

const MD_MEDIA = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

function splitContentWithEmbeds(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  const re = new RegExp(MD_MEDIA.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ type: 'text', value: text.slice(last, m.index) });
    }
    out.push({ type: 'embed', alt: m[1], url: m[2], raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ type: 'text', value: text.slice(last) });
  }
  return out;
}

type Props = {
  text: string;
  className?: string;
  textClassName?: string;
  embedMediaClassName?: string;
};

/**
 * 본문에 포함된 마크다운 형식 `![alt](url)` 만 안전하게 렌더링합니다.
 * 신뢰 URL이 아니면 원문 문자열로만 표시합니다.
 */
export function PostRichContent({ text, className, textClassName, embedMediaClassName }: Props) {
  if (!text.trim()) return null;
  const segments = splitContentWithEmbeds(text);

  return (
    <div className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return (
            <span key={i} className={textClassName}>
              {seg.value}
            </span>
          );
        }
        if (!isTrustedMediaUrl(seg.url)) {
          return (
            <span key={i} className={textClassName}>
              {seg.raw}
            </span>
          );
        }
        if (isVideoUrl(seg.url)) {
          return (
            <video
              key={i}
              src={seg.url}
              controls
              playsInline
              preload="metadata"
              className={embedMediaClassName}
              aria-label={seg.alt || '본문 영상'}
            />
          );
        }
        return (
          // eslint-disable-next-line @next/next/no-img-element -- R2 등 신뢰 URL만
          <img
            key={i}
            src={seg.url}
            alt={seg.alt || '본문 이미지'}
            className={embedMediaClassName}
          />
        );
      })}
    </div>
  );
}
