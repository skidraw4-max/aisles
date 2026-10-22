import { prepareNoticeContent } from '@/lib/notice-content';
import styles from '@/app/(root)/notices/[id]/notice-detail.module.css';

type Props = {
  content: string;
  className?: string;
};

export function NoticeContent({ content, className }: Props) {
  const prepared = prepareNoticeContent(content);
  const bodyClass = className ?? styles.body;

  if (prepared.mode === 'text') {
    if (!prepared.text) {
      return <p className={`${bodyClass} ${styles.bodyEmpty}`}>등록된 본문이 없습니다.</p>;
    }
    return <div className={bodyClass}>{prepared.text}</div>;
  }

  if (!prepared.html) {
    return <p className={`${bodyClass} ${styles.bodyEmpty}`}>등록된 본문이 없습니다.</p>;
  }

  return (
    <div
      className={`${bodyClass} ${styles.bodyHtml}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: prepared.html }}
    />
  );
}
