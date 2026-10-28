import Link from 'next/link';
import { juryHref, jurySignupHref } from '@/lib/jury-product/jury-url';
import styles from './jury-landing.module.css';

const FLOW = [
  {
    step: '01',
    label: '근거',
    tone: styles.toneEvidence,
    text: '서비스를 연결하고 심사의 바탕이 될 근거를 모아요.',
  },
  {
    step: '02',
    label: '심사',
    tone: styles.toneJury,
    text: '모은 근거로 AI 심사를 실행하고 최종 보고서를 확인해요.',
  },
  {
    step: '03',
    label: '개선',
    tone: styles.toneImprove,
    text: '발견한 문제를 개선 작업으로 만들고, 담당자 판단을 결과 옆에 남겨요.',
  },
  {
    step: '04',
    label: '재심사',
    tone: styles.toneRereview,
    text: '바뀐 서비스를 다시 심사하고 이전 결과와 비교해요.',
  },
] as const;

const CAPABILITIES = [
  {
    title: '심사 근거 관리',
    text: '결론을 내리기 전에 연결한 서비스별로 근거를 모으고 살펴봐요.',
  },
  {
    title: 'AI 심사와 최종 보고서',
    text: '심사를 시작하고 심사별 최종 보고서까지 결과를 확인해요.',
  },
  {
    title: '조직과 권한',
    text: '구성원을 초대하고 역할을 정하고, 구성원별 서비스 접근 권한을 관리해요.',
  },
  {
    title: '감사 이력과 개선 추적',
    text: '개선 주기마다 무엇을 심사하고 결정하고 바꿨는지 따라가요.',
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
