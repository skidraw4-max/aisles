import Link from 'next/link';
import { juryHref, jurySignupHref } from '@/lib/jury-product/jury-url';
import styles from './jury-entry.module.css';

const FLOW = [
  { label: 'Evidence', className: styles.evidence },
  { label: 'Jury', className: styles.jury },
  { label: 'Improve', className: styles.improve },
  { label: 'Agent', className: styles.agent },
  { label: 'Re-review', className: styles.rereview },
] as const;

export function JuryLanding({ notice }: { notice?: string }) {
  return (
    <section className={styles.screen}>
      <div className={styles.frame}>
        <h1 className={styles.brand}>AIsles Jury</h1>
        <p className={styles.studio}>by AIsles Studio</p>
        <p className={styles.kicker}>AI Services Under Review</p>
        <p className={styles.message}>Verify. Improve. Review Again.</p>
        <ol className={styles.flow} aria-label="Review flow">
          {FLOW.map((step, index) => (
            <li key={step.label}>
              {index > 0 ? <span className={styles.arrow} aria-hidden="true">→ </span> : null}
              <span className={step.className}>{step.label}</span>
            </li>
          ))}
        </ol>
        <ul className={styles.status} aria-label="Review states">
          <li className={styles.pass}>PASS</li>
          <li className={styles.verify}>VERIFY</li>
          <li className={styles.issue}>ISSUE</li>
        </ul>
        {notice ? <p className={styles.note} role="status">{notice}</p> : null}
        <div className={styles.actions}>
          <Link className={styles.primary} href={juryHref('/login')}>
            Sign In
          </Link>
          <Link className={styles.textLink} href={jurySignupHref()}>
            Create account
          </Link>
        </div>
      </div>
    </section>
  );
}
