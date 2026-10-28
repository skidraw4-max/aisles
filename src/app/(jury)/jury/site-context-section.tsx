/** P1 (JD t568): 사이트 정보 — user-entered purpose/identity for reviews. Not observed evidence. */
import { loadSiteContext, siteTypeLabel } from '@/lib/jury-product/site-context';
import { saveSiteContextAction } from './site-context-actions';
import { SiteContextForm } from './site-context-form';
import styles from './jury.module.css';

export async function SiteContextSection(props: { tenantId: string; connectionId: string; canWrite: boolean; deleted: boolean }) {
  const current = await loadSiteContext(props.tenantId, props.connectionId).catch(() => null);
  return (
    <section className={styles.panel} aria-labelledby="site-context-title">
      <h2 id="site-context-title">사이트 정보</h2>
      <p className={styles.muted}>사이트의 목적과 지킬 특성을 알려주면, 위원이 일반 기준뿐 아니라 이 사이트에 맞는지까지 봐요. 입력한 내용은 관찰 근거가 아니라 참고 정보로만 쓰여요.</p>
      {props.deleted ? (
        <p className={styles.muted}>삭제된 서비스라 사이트 정보를 바꿀 수 없어요.</p>
      ) : props.canWrite ? (
        <SiteContextForm connectionId={props.connectionId} current={current} action={saveSiteContextAction} />
      ) : current ? (
        <ul className={styles.resultList}>
          <li>사이트 유형: {siteTypeLabel(current.siteType)}</li>
          {current.primaryUsers ? <li>주요 사용자: {current.primaryUsers}</li> : null}
          {current.coreTasks.length ? <li>핵심 작업: {current.coreTasks.join(', ')}</li> : null}
          {current.brandTraits ? <li>유지할 브랜드 특성: {current.brandTraits}</li> : null}
        </ul>
      ) : (
        <p className={styles.muted}>아직 입력된 사이트 정보가 없어요.</p>
      )}
    </section>
  );
}
