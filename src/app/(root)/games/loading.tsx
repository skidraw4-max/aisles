import styles from './games.module.css';

export default function GamesHubLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="게임 허브 불러오는 중">
      <p className={styles.lede}>게임 허브를 불러오는 중입니다…</p>
    </div>
  );
}
