import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AiFortuneWeeklyPayload } from '@/lib/ai-fortune/payload';
import { MbtiTypeIcon } from '@/lib/ai-fortune/mbti-icons';
import { AiFortuneMbtiHashScroll } from './AiFortuneMbtiHashScroll';
import styles from './ai-fortune-report.module.css';

type Props = {
  title: string;
  weekLabel: string;
  authorUsername: string;
  createdAt: Date;
  payload: AiFortuneWeeklyPayload;
  engagement: ReactNode;
};

function formatDateShort(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

export function AiFortuneReport({
  title,
  weekLabel,
  authorUsername,
  createdAt,
  payload,
  engagement,
}: Props) {
  const label = payload.weekLabel || weekLabel;

  return (
    <article className={styles.report}>
      <AiFortuneMbtiHashScroll />
      <nav className={styles.breadcrumb} aria-label="경로">
        <Link href="/?category=AI_FORTUNE">AI FORTUNE</Link>
        <span aria-hidden> / </span>
        <span>주간 리포트</span>
      </nav>

      <header className={styles.hero}>
        <p className={styles.eyebrow}>Oracle · AI Temple</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.meta}>
          {label} · {authorUsername} ·{' '}
          <time dateTime={createdAt.toISOString()}>{formatDateShort(createdAt)}</time>
        </p>
      </header>

      <section className={styles.trendsSection} aria-labelledby="ai-fortune-trends">
        <h2 id="ai-fortune-trends" className={styles.sectionLabel}>
          이번 주 AI 흐름
        </h2>
        <ol className={styles.trendList}>
          {payload.trendBullets.map((trend, i) => (
            <li key={i} className={styles.trendItem}>
              <span className={styles.trendIndex}>{i + 1}</span>
              {trend}
            </li>
          ))}
        </ol>
      </section>

      <section
        id="ai-fortune-grid"
        className={styles.gridSection}
        aria-labelledby="ai-fortune-mbti"
      >
        <h2 id="ai-fortune-mbti" className={styles.sectionLabel}>
          MBTI 16 — 주간 AI 운세
        </h2>
        <div className={styles.grid}>
          {payload.mbti.map((entry) => (
            <article key={entry.type} id={`mbti-${entry.type}`} className={styles.card}>
              <header className={styles.cardHeader}>
                <MbtiTypeIcon type={entry.type} className={styles.cardIcon} />
                <span className={styles.cardType}>{entry.type}</span>
              </header>
              <div className={styles.cardBlock}>
                <p className={styles.cardBlockLabel}>이번 주 AI 활용</p>
                <p className={styles.cardBlockText}>{entry.strategy}</p>
              </div>
              <div className={styles.cardBlock}>
                <p className={styles.cardBlockLabel}>행운의 키워드</p>
                <p className={`${styles.cardBlockText} ${styles.lucky}`}>{entry.luckyKeyword}</p>
              </div>
              <div className={styles.cardBlock}>
                <p className={styles.cardBlockLabel}>피할 습관</p>
                <p className={`${styles.cardBlockText} ${styles.avoid}`}>{entry.avoidHabit}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {payload.closingNote ? <p className={styles.closing}>{payload.closingNote}</p> : null}

      <footer className={styles.engagement}>{engagement}</footer>
    </article>
  );
}
