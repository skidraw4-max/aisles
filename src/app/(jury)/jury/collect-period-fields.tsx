/** RM-09 (I-010): evidence collection period inputs (replaces the hardcoded 2026-09-01~09-07). */
import { intakePeriodDefaults } from '@/lib/jury-product/evidence-period';
import styles from './jury.module.css';

export function CollectPeriodFields() {
  const period = intakePeriodDefaults();
  return (
    <>
      <label>
        시작일
        <input className={styles.field} type="date" name="periodStart" defaultValue={period.start} max={period.today} required />
      </label>
      <label>
        종료일
        <input className={styles.field} type="date" name="periodEnd" defaultValue={period.end} max={period.today} required />
      </label>
      <p className={styles.muted}>Asia/Seoul 기준 · 최대 92일 · 기본값은 어제까지 7일</p>
    </>
  );
}
