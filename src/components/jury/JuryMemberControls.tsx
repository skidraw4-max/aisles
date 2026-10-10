'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeJuryMemberRole, removeJuryMember } from '@/app/(root)/jury/organization/members/actions';
import styles from './jury-entry.module.css';
import listStyles from './invitation.module.css';

const ROLES = [
  ['ADMIN', 'Administrator'],
  ['REVIEWER', 'Reviewer'],
  ['DEVELOPER', 'Developer'],
  ['VIEWER', 'Viewer'],
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
      setMessage('Role could not be changed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={listStyles.controls} onSubmit={handleSave}>
      <label className={styles.field}>
        Role
        <select className={listStyles.select} name="role" value={nextRole} onChange={(event) => setNextRole(event.target.value as (typeof ROLES)[number][0])}>
          {ROLES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <button className={styles.primary} type="submit" disabled={loading || nextRole === role}>Save role</button>
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
      setMessage('Member could not be removed');
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return <button className={listStyles.remove} type="button" onClick={() => setOpen(true)}>Remove</button>;
  }

  return (
    <div className={listStyles.confirm}>
      <p>Remove this member?</p>
      <p>email: {email}</p>
      <p>role: {roleLabel}</p>
      <p>Removing this member will also remove their access to services in this organization.</p>
      {message ? <p className={styles.alert} role="alert">{message}</p> : null}
      <div className={listStyles.confirmActions}>
        <button className={listStyles.remove} type="button" onClick={() => setOpen(false)} disabled={loading}>Cancel</button>
        <button className={styles.primary} type="button" onClick={() => void handleRemove()} disabled={loading}>Remove</button>
      </div>
    </div>
  );
}
