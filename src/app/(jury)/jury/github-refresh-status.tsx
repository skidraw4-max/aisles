import { readGithubRefreshStatus, type GithubRefreshStatusState } from '@/lib/jury-product/services/github/refresh-status';
import styles from './jury.module.css';

const COPY: Record<Exclude<GithubRefreshStatusState, 'hidden'>, string> = {
  none: 'Refresh 기록 없음',
  'in-progress': 'Refresh 진행 중',
  reusable: 'Refresh 완료 — 기존 결과 재사용 가능',
  failed: 'Refresh 실패 — 자동 재실행되지 않음',
  unavailable: '상태 확인 불가',
};

/** Shows stored GitHub Refresh state. It does not submit a refresh. */
export async function GithubRefreshStatus({ connectionId }: { connectionId: string }) {
  const status = await readGithubRefreshStatus(connectionId);
  if (status.state === 'hidden') return null;
  return (
    <section className={styles.header} aria-label="GitHub Refresh 상태">
      <h2 className={styles.title}>GitHub Refresh</h2>
      <p className={styles.lead}>{COPY[status.state]}</p>
    </section>
  );
}
