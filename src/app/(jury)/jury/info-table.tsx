/**
 * I-088: 항목 | 값 | 상태 table and a 2-column definition list for the 연결 설정 tab.
 * No hooks, so usable from server and client components. Missing values render a faint
 * '—' hidden from screen readers plus an srOnly label, so empty cells are never silent.
 */
import type { ReactNode } from 'react';
import styles from './jury.module.css';

export function NoValue({ label = '상태 없음' }: { label?: string }) {
  return (
    <>
      <span aria-hidden="true" className={styles.noStatus}>—</span>
      <span className={styles.srOnly}>{label}</span>
    </>
  );
}

export function InfoTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className={styles.resultTableWrap}>
      <table className={`${styles.resultTable} ${styles.infoTable}`}>
        <caption className={styles.srOnly}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">항목</th>
            <th scope="col">값</th>
            <th scope="col">상태</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function InfoRow({ label, value, status, title }: { label: ReactNode; value?: ReactNode; status?: ReactNode; title?: string }) {
  const hasValue = value !== undefined && value !== null && value !== '';
  return (
    <tr>
      <th scope="row">{label}</th>
      <td title={title}>{hasValue ? value : <NoValue label="값 없음" />}</td>
      <td>{status ?? <NoValue />}</td>
    </tr>
  );
}

export function InfoList({ label, children }: { label: string; children: ReactNode }) {
  return <dl className={styles.infoList} aria-label={label}>{children}</dl>;
}

export function InfoItem({ term, children }: { term: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{children ?? <NoValue />}</dd>
    </div>
  );
}
