'use client';
/** I-079: danger button + typed-name confirmation dialog for deleting a service connection. */
import { useActionState, useRef, useState } from 'react';
import { deleteConnectionAction, type ConnectionDeleteActionState } from './connection-delete-actions';
import styles from './jury.module.css';
import { Trash2 } from 'lucide-react';
import { buttonClass } from './jury-controls';

export function ConnectionDeleteDialog({ connectionId, displayName, github }: { connectionId: string; displayName: string; github: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const [state, action, pending] = useActionState<ConnectionDeleteActionState, FormData>(deleteConnectionAction, null);
  const matches = typed.normalize('NFC').trim() === displayName.normalize('NFC').trim() && typed.trim().length > 0;
  return (
    <>
      <button type="button" className={styles.iconButton} onClick={() => dialogRef.current?.showModal()} aria-haspopup="dialog" aria-label="삭제" title="삭제">
        <Trash2 aria-hidden size={16} />
      </button>
      <dialog ref={dialogRef} className={styles.confirmDialog} aria-labelledby={`del-${connectionId}`}>
        <h3 id={`del-${connectionId}`}>연결 삭제</h3>
        {state?.ok ? (
          <div role="status">
            <p>{state.message}</p>
            <p><button type="button" className={buttonClass('ghost')} onClick={() => dialogRef.current?.close()}>닫기</button></p>
          </div>
        ) : (
          <form action={action}>
            <input type="hidden" name="connectionId" value={connectionId} />
            <p><strong>{displayName}</strong> 연결을 삭제하면 바로 아래 항목이 해제돼요. 되돌릴 수 없어요.</p>
            <p>바로 삭제·해제되는 항목</p>
            <ul>
              <li>저장된 읽기 전용 로그인 정보</li>
              <li>관찰 동의와 GA4 속성 설정</li>
              <li>도메인 소유권 확인</li>
              <li>보관 중인 화면 캡처</li>
              <li>진행 중인 화면 심사와 심사 요청(취소돼요)</li>
            </ul>
            <p>남겨 두는 항목</p>
            <ul>
              <li>지난 심사 결과와 판단 기록</li>
              <li>감사 기록(누가 언제 삭제했는지)</li>
            </ul>
            {github ? (
              <p className={styles.secondaryHint}>GitHub 앱 설치는 Jury에서 지울 수 없어요. 삭제 후 GitHub 설정 &gt; Applications에서 직접 제거해 주세요.</p>
            ) : null}
            <label>
              확인을 위해 서비스 이름 <strong>{displayName}</strong>을(를) 입력해 주세요.
              <input name="confirmName" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" required />
            </label>
            {state && !state.ok ? <p role="alert">{state.message}</p> : null}
            <p>
              <button type="button" className={buttonClass('ghost')} onClick={() => dialogRef.current?.close()}>취소</button>{' '}
              <button type="submit" className={buttonClass('danger')} disabled={!matches || pending}>
                {pending ? '삭제하는 중…' : '연결 삭제'}
              </button>
            </p>
          </form>
        )}
      </dialog>
    </>
  );
}
