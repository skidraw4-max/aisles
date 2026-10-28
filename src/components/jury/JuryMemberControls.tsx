'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeJuryMemberRole, removeJuryMember } from '@/app/(jury)/jury/organization/members/actions';
import styles from './jury-entry.module.css';
import listStyles from './invitation.module.css';
import { userLabel } from '@/lib/jury-product/ui-labels';

/** Role values are unchanged; labels come from the shared Korean dictionary. */
const ROLES = [
  ['ADMIN', userLabel('ADMIN')],
  ['REVIEWER', userLabel('REVIEWER')],
  ['DEVELOPER', userLabel('DEVELOPER')],
  ['VIEWER', userLabel('VIEWER')],
] as const;

export function JuryMemberRoleControl({
  memberUserId,
  role,
}: {
  memberUserId: string;
  role: (typeof ROLES)[number][0];
}) {
  const router = useRouter();
  const [nextRole, setNextRole] = useState(role);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('memberUserId', memberUserId);
      formData.set('role', nextRole);
      const result = await changeJuryMemberRole(formData);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    } catch {
      setMessage('역할을 변경하지 못했어요');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={listStyles.controls} onSubmit={handleSave}>
      <label className={styles.field}>
        역할
        <select className={listStyles.select} name="role" value={nextRole} onChange={(event) => setNextRole(event.target.value as (typeof ROLES)[number][0])}>
          {ROLES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <button className={styles.primary} type="submit" disabled={loading || nextRole === role}>역할 저장</button>
      {message ? <p className={styles.alert} role="alert">{message}</p> : null}
    </form>
  );
}

export function JuryMemberRemoveControl({
  memberUserId,
  email,
  roleLabel,
}: {
  memberUserId: string;
  email: string;
  roleLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRemove = async () => {
    setMessage(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('memberUserId', memberUserId);
      const result = await removeJuryMember(formData);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setMessage('구성원을 삭제하지 못했어요');
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return <button className={listStyles.remove} type="button" onClick={() => setOpen(true)}>삭제</button>;
  }

  return (
    <div className={listStyles.confirm}>
      <p>이 구성원을 삭제할까요?</p>
      <p>email: {email}</p>
      <p>역할: {roleLabel}</p>
      <p>이 구성원을 삭제하면 이 조직의 서비스 접근 권한도 함께 삭제돼요.</p>
      {message ? <p className={styles.alert} role="alert">{message}</p> : null}
      <div className={listStyles.confirmActions}>
        <button className={listStyles.remove} type="button" onClick={() => setOpen(false)} disabled={loading}>취소</button>
        <button className={styles.primary} type="button" onClick={() => void handleRemove()} disabled={loading}>삭제</button>
      </div>
    </div>
  );
}
