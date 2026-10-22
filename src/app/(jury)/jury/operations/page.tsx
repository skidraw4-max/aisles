import { isJuryStoreUnavailable } from '@/lib/jury-product/jury-db';
import { loadOperatorMetrics } from '@/lib/jury-product/operator-metrics';
import { RESULT_SOURCE_LABELS } from '@/lib/jury-product/review-display-model';
import { getJuryActor } from '@/lib/jury-product/session';
import { displayText } from '@/lib/jury-product/ui-labels';
import { JuryChrome } from '../ui';
import styles from '../jury.module.css';

/** RM-14 (I-012): 운영 지표. OWNER/ADMIN, 현재 조직만, 읽기 전용. */
export default async function JuryOperationsPage() {
  const actor = await getJuryActor();
  if (!actor.ok) return <JuryChrome actor={actor}>{null}</JuryChrome>;
  try {
    const loaded = await loadOperatorMetrics(actor);
    if (!loaded.ok) {
      return <JuryChrome actor={actor}><p role="alert">운영 지표는 소유자·관리자만 볼 수 있습니다.</p></JuryChrome>;
    }
    const m = loaded.metrics;
    return (
      <JuryChrome actor={actor}>
        <section className={styles.panel}>
          <h2>운영 지표 (최근 {m.windowDays}일)</h2>
          <p className={styles.muted}>현재 조직의 심사 요청만 집계합니다. 비율은 종료된 요청 기준 정수 %입니다.</p>
          <div className={styles.row}><span className={styles.label}>전체 심사 요청</span><span>{m.total}건</span></div>
          <div className={styles.row}><span className={styles.label}>상태별</span><span>{m.byStatus.length ? m.byStatus.map((s) => `${displayText(s.status)} ${s.count}`).join(' · ') : '기록 없음'}</span></div>
          <div className={styles.row}><span className={styles.label}>완료율</span><span>{m.completionRate.value === null ? m.completionRate.note : `${m.completionRate.value}% (${m.completionRate.note})`}</span></div>
          <div className={styles.row}><span className={styles.label}>소요 시간</span><span>{m.duration.medianSec === null ? '측정 가능한 요청 없음' : `중앙값 ${m.duration.medianSec}초 · 최대 ${m.duration.maxSec}초 (${m.duration.measured}건)`}{m.duration.excludedLegacy ? ` · 출처 미기록 ${m.duration.excludedLegacy}건 제외` : ''}</span></div>
          <div className={styles.row}><span className={styles.label}>결과 출처</span><span>{m.bySource.map((s) => `${RESULT_SOURCE_LABELS[s.source as keyof typeof RESULT_SOURCE_LABELS] ?? s.source} ${s.count}`).join(' · ') || '기록 없음'}</span></div>
        </section>
        <section className={styles.panel}>
          <h2>실패 사유</h2>
          {m.failureReasons.length === 0 ? <p className={styles.muted}>실패 기록 없음</p> : (
            <ul>{m.failureReasons.map((r) => <li key={r.reason}>{r.reason} — {r.count}건</li>)}</ul>
          )}
        </section>
        <section className={styles.panel}>
          <h2>모델별 호출</h2>
          {m.models.length === 0 ? <p className={styles.muted}>호출 기록 없음</p> : (
            <ul>{m.models.map((r) => <li key={r.model}>{r.model} — 성공 {r.ok} · 실패 {r.failed}</li>)}</ul>
          )}
        </section>
      </JuryChrome>
    );
  } catch (error) {
    if (isJuryStoreUnavailable(error)) return <JuryChrome actor={{ ok: false, reason: 'STORE_UNAVAILABLE' }}>{null}</JuryChrome>;
    throw error;
  }
}
