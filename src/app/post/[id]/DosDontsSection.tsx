import styles from './post.module.css';

const DOS = [
  '주제·조명·구도를 한 문장씩 나눠 단계적으로 추가하기',
  '참고 스타일(영화, 화가, 렌즈)을 구체적으로 명시하기',
  '비율·해상도·버전 파라미터를 초반에 고정하기',
];

const DONTS = [
  '모호한 형용사만 나열하고 피사체를 빼먹기',
  '저작권·초상권이 불분명한 실존 인물·브랜드 강제 지정',
  '한 번에 수십 개 키워드를 붙여 결과를 예측 불가로 만들기',
];

export function DosDontsSection() {
  return (
    <section className={`${styles.dosDontsCard} ${styles.magazineCard}`} aria-labelledby="dos-donts-heading">
      <h2 id="dos-donts-heading" className={styles.dosDontsHeading}>
        DOs &amp; DON&apos;Ts
      </h2>
      <p className={styles.dosDontsSub}>프롬프트 작성 시 자주 하는 실수와 권장 패턴입니다.</p>
      <div className={styles.dosDontsGrid}>
        <div className={styles.dosDontsCol}>
          <h3 className={styles.dosDontsColTitle}>
            <span className={styles.dosMark} aria-hidden>
              ✓
            </span>
            DOs
          </h3>
          <ul className={styles.dosDontsList}>
            {DOS.map((t) => (
              <li key={t} className={styles.dosItem}>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className={`${styles.dosDontsCol} ${styles.dosDontsColDivider}`}>
          <h3 className={styles.dosDontsColTitle}>
            <span className={styles.dontMark} aria-hidden>
              ✕
            </span>
            DON&apos;Ts
          </h3>
          <ul className={styles.dosDontsList}>
            {DONTS.map((t) => (
              <li key={t} className={styles.dontItem}>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
