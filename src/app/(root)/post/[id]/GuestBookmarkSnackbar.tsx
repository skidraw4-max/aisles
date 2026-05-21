'use client';

import { sendGAEvent } from '@/lib/ga4';
import styles from './guest-bookmark-snackbar.module.css';

type Props = {
  open: boolean;
  postId: string;
  onLogin: () => void;
};

export function GuestBookmarkSnackbar({ open, postId, onLogin }: Props) {
  return (
    <div
      className={`${styles.snackbar} ${open ? styles.snackbarOpen : ''}`}
      role="status"
      aria-live="polite"
      aria-hidden={!open}
    >
      💡 브라우저에 임시 저장되었습니다. 구글 로그인 시 다른 기기에서도 영구 보관이 가능합니다.
      <button
        type="button"
        className={styles.loginLink}
        onClick={() => {
          sendGAEvent('guest_bookmark_login_click', { post_id: postId });
          onLogin();
        }}
      >
        [로그인하기]
      </button>
    </div>
  );
}
