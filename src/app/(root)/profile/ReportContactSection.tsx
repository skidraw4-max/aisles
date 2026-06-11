import Link from 'next/link';
import {
  buildContentReportMailtoUrl,
  buildCsaeReportMailtoUrl,
  CHILD_SAFETY_POLICY_PATH,
  getChildSafetyContactEmail,
} from '@/lib/legal-site';
import styles from './profile.module.css';

export function ReportContactSection() {
  const csaeMailto = buildCsaeReportMailtoUrl();
  const contentMailto = buildContentReportMailtoUrl();
  const contactEmail = getChildSafetyContactEmail();

  return (
    <section className={styles.reportSection} aria-labelledby="report-contact-heading">
      <h2 id="report-contact-heading" className={styles.reportTitle}>
        신고·문의
      </h2>
      <p className={styles.reportLead}>
        불법·유해 콘텐츠, 권리 침해, <strong>아동 안전(CSAE)</strong> 관련 의심 사항을 신고할 수 있습니다. 앱
        내에서 아래 버튼을 누르면 이메일 앱이 열립니다.
      </p>
      <div className={styles.reportActions}>
        <a className={styles.reportBtnPrimary} href={csaeMailto}>
          아동 안전(CSAE) 신고
        </a>
        <a className={styles.reportBtnSecondary} href={contentMailto}>
          콘텐츠 신고
        </a>
      </div>
      <p className={styles.reportMeta}>
        <Link href={CHILD_SAFETY_POLICY_PATH}>아동 안전 정책</Link>
        {' · '}
        <Link href="/support">고객지원</Link>
        {' · '}
        <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
      </p>
    </section>
  );
}
