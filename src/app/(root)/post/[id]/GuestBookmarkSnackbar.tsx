'use client';

import styles from './guest-bookmark-snackbar.module.css';

type Props = {
  open: boolean;
  onLogin: () => void;
};

export function GuestBookmarkSnackbar({ open, onLogin }: Props) {
  return (
    <div
      className={`${styles.snackbar} ${open ? styles.snackbarOpen : ''}`}
      role="status"
      aria-live="polite"
      aria-hidden={!open}
    >
      💡 브라우저에 임시 저장되었습니다. 구글 로그인 시 다른 기기에서도 영구 보관이 가능합니다.
      <button type="button" className={styles.loginLink} onClick={onLogin}>
        [로그인하기]
      </button>
    </div>
  );
}
