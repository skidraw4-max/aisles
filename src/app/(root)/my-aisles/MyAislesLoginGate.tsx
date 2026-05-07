import Link from 'next/link';
import { Bookmark, Bell, Users } from 'lucide-react';
import styles from './my-aisles.module.css';

const LOGIN_HREF = '/login?next=/my-aisles';

export function MyAislesLoginGate() {
  return (
    <main className={styles.main}>
      <div className={styles.inner}>
        <nav className={styles.breadcrumb} aria-label="경로">
          <Link href="/">홈</Link>
          <span aria-hidden>/</span>
          <span>My Aisles</span>
        </nav>
        <h1 className={styles.title}>My Aisles</h1>

        <div className={styles.loginGatePanel} role="region" aria-labelledby="my-aisles-gate-title">
          <div className={styles.loginGatePopup} aria-labelledby="my-aisles-gate-title">
            <h2 id="my-aisles-gate-title" className={styles.loginGatePopupTitle}>
              나만의 AI 지식 창고를 만들어보세요!
            </h2>
            <p className={styles.loginGatePopupText}>
              로그인을 하면 읽었던 기사를 저장하고 언제 어디서든 다시 꺼내 볼 수 있습니다.
            </p>
            <div className={styles.loginGateActions}>
              <Link href={LOGIN_HREF} className={styles.loginGatePrimary}>
                로그인
              </Link>
              <Link href="/" className={styles.loginGateSecondary}>
                홈으로
              </Link>
            </div>
          </div>

          <p className={styles.loginGateFeaturesLead}>로그인 후 이용 가능한 기능</p>
          <ul className={styles.loginGateFeatures}>
            <li className={styles.loginGateFeature}>
              <span className={styles.loginGateFeatureIcon} aria-hidden>
                <Bookmark size={22} strokeWidth={2} />
              </span>
              <span className={styles.loginGateFeatureLabel}>북마크 저장</span>
            </li>
            <li className={styles.loginGateFeature}>
              <span className={styles.loginGateFeatureIcon} aria-hidden>
                <Bell size={22} strokeWidth={2} />
              </span>
              <span className={styles.loginGateFeatureLabel}>관심 키워드 알림</span>
            </li>
            <li className={styles.loginGateFeature}>
              <span className={styles.loginGateFeatureIcon} aria-hidden>
                <Users size={22} strokeWidth={2} />
              </span>
              <span className={styles.loginGateFeatureLabel}>커뮤니티 참여</span>
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
