import Link from 'next/link';
import { juryHref, jurySignupHref } from '@/lib/jury-product/jury-url';
import styles from './jury-landing.module.css';

const FLOW = [
  {
    step: '01',
    label: 'Evidence',
    tone: styles.toneEvidence,
    text: 'Connect a service and collect the evidence a review should rest on.',
  },
  {
    step: '02',
    label: 'Jury',
    tone: styles.toneJury,
    text: 'Run an AI review against that evidence and read the final report.',
  },
  {
    step: '03',
    label: 'Improve',
    tone: styles.toneImprove,
    text: 'Turn findings into improvement tasks, with human decisions kept beside the result.',
  },
  {
    step: '04',
    label: 'Re-review',
    tone: styles.toneRereview,
    text: 'Review the changed service again and compare it with the earlier result.',
  },
] as const;

const CAPABILITIES = [
  {
    title: 'Evidence management',
    text: 'Gather and browse evidence per connected service before anything is judged.',
  },
  {
    title: 'AI review and final report',
    text: 'Start a review run and open its result, including the final report for each review.',
  },
  {
    title: 'Organizations and permissions',
    text: 'Invite members, assign roles, and control which services each member can access.',
  },
  {
    title: 'Audit and improvement trace',
    text: 'Follow what was reviewed, decided, and changed across each improvement cycle.',
  },
] as const;

export function JuryLanding({ notice }: { notice?: string }) {
  const loginHref = juryHref('/login');
  const signupHref = jurySignupHref();

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <p className={styles.wordmark}>
          AIsles Jury
          <span className={styles.wordmarkSub}>by AIsles Studio</span>
        </p>
        <nav aria-label="Account">
          <Link className={styles.navLink} href={loginHref}>
            Sign In
          </Link>
        </nav>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="jury-hero-title">
          <p className={styles.kicker}>AI Services Under Review</p>
          <h1 id="jury-hero-title" className={styles.heroTitle}>
            Verify. Improve. Review Again.
          </h1>
          <p className={styles.lead}>
            AIsles Jury reviews AI services against collected evidence, turns findings into
            improvements, and checks the result again, so every quality decision has a record behind it.
          </p>
          {notice ? (
            <p className={styles.note} role="status">
              {notice}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Link className={styles.primary} href={loginHref}>
              Sign In
            </Link>
            <Link className={styles.secondary} href={signupHref}>
              Create account
            </Link>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="jury-flow-title">
          <h2 id="jury-flow-title" className={styles.sectionTitle}>
            How it works
          </h2>
          <ol className={styles.flow}>
            {FLOW.map((item) => (
              <li key={item.label} className={styles.flowItem}>
                <span className={styles.flowStep} aria-hidden="true">
                  {item.step}
                </span>
                <h3 className={`${styles.flowLabel} ${item.tone}`}>{item.label}</h3>
                <p className={styles.cardText}>{item.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="jury-capabilities-title">
          <h2 id="jury-capabilities-title" className={styles.sectionTitle}>
            What you can do
          </h2>
          <ul className={styles.grid}>
            {CAPABILITIES.map((item) => (
              <li key={item.title} className={styles.card}>
                <h3 className={styles.cardTitle}>{item.title}</h3>
                <p className={styles.cardText}>{item.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={`${styles.section} ${styles.cta}`} aria-labelledby="jury-cta-title">
          <h2 id="jury-cta-title" className={styles.sectionTitle}>
            Put your AI service under review
          </h2>
          <p className={styles.lead}>Sign in to open your workspace, or create an account to get started.</p>
          <div className={styles.actions}>
            <Link className={styles.primary} href={loginHref}>
              Sign In
            </Link>
            <Link className={styles.secondary} href={signupHref}>
              Create account
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p>AIsles Jury · by AIsles Studio</p>
      </footer>
    </div>
  );
}
