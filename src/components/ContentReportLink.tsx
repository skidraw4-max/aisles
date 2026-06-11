import { buildContentReportMailtoUrl } from '@/lib/legal-site';
import styles from './content-report-link.module.css';

type Props = {
  postUrl: string;
  className?: string;
};

/** 게시글·댓글 등 UGC 신고 — Google Play 앱 내 신고 경로 */
export function ContentReportLink({ postUrl, className }: Props) {
  const mailto = buildContentReportMailtoUrl({ postUrl });

  return (
    <p className={className ?? styles.wrap}>
      <a className={styles.link} href={mailto}>
        신고
      </a>
      <span className={styles.hint}> · 불법·유해·아동 안전(CSAE) 관련 콘텐츠</span>
    </p>
  );
}
