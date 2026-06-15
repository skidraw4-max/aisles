'use client';

import { useRouter } from 'next/navigation';
import styles from './post.module.css';

type Props = {
  postId: string;
  onClose: () => void;
};

/** 비로그인 N회 글 열람 후 가입 유도 — ssr:false 동적 로드 */
export function PostSignupPromptModal({ postId, onClose }: Props) {
  const router = useRouter();

  function goSignup() {
    onClose();
    router.push(`/login?next=${encodeURIComponent(`/post/${postId}`)}`);
  }

  return (
    <div
      className={styles.signupPromptBackdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.signupPromptModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signup-prompt-title"
        aria-describedby="signup-prompt-desc"
      >
        <h3 id="signup-prompt-title" className={styles.signupPromptTitle}>
          읽은 AI 기사, 한곳에 모아보세요
        </h3>
        <p id="signup-prompt-desc" className={styles.signupPromptDesc}>
          회원가입하면 관심 기사를 북마크해 <strong>My Aisles</strong>에서 언제든 다시 볼 수 있어요.
        </p>
        <p className={styles.signupPromptSub}>무료로 바로 시작할 수 있습니다.</p>
        <div className={styles.signupPromptActions}>
          <button type="button" className={styles.signupPromptPrimary} onClick={goSignup}>
            회원가입하고 모아보기
          </button>
          <button type="button" className={styles.signupPromptGhost} onClick={onClose}>
            나중에
          </button>
        </div>
      </div>
    </div>
  );
}
