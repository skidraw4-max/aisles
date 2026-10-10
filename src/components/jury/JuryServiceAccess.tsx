'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  addJuryServiceMember,
  changeJuryServiceMemberPermission,
  removeJuryServiceMember,
} from '@/app/(root)/jury/organization/services/actions';
import styles from './jury-entry.module.css';
import listStyles from './invitation.module.css';

const PERMISSIONS = [
  ['VIEW', 'View'],
  ['REVIEW', 'Review'],
  ['IMPROVE', 'Improve'],
  ['AGENT', 'Agent'],
] as const;

type Permission = (typeof PERMISSIONS)[number][0];

export function JuryServiceMemberAdd({
  connectionId,
  candidates,
}: {
  connectionId: string;
  candidates: readonly { userId: string; email: string; displayName: string | null; orgRole: string }[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [memberUserId, setMemberUserId] = useState(candidates[0]?.userId ?? '');
  const [permission, setPermission] = useState<Permission>('VIEW');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (candidates.length === 0) return null;
  const needle = query.trim().toLowerCase();
  const visible = candidates.filter((candidate) => {
    if (!needle) return true;
    return `${candidate.displayName ?? ''} ${candidate.email} ${candidate.orgRole}`.toLowerCase().includes(needle);
  });
  const selected = visible.some((candidate) => candidate.userId === memberUserId) ? memberUserId : (visible[0]?.userId ?? '');

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('serviceConnectionId', connectionId);
      formData.set('memberUserId', selected);
      formData.set('permission', permission);
      const result = await addJuryServiceMember(formData);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    } catch {
      setMessage('Service access could not be changed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={listStyles.controls} onSubmit={handleAdd}>
      <label className={styles.field}>
        Find member
        <input className={styles.field} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" />
      </label>
      <label className={styles.field}>
        Add member
        <select className={listStyles.select} value={selected} onChange={(event) => setMemberUserId(event.target.value)}>
          {visible.map((candidate) => (
            <option key={candidate.userId} value={candidate.userId}>
              {candidate.displayName ?? candidate.email} · {candidate.orgRole}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Permission
        <select className={listStyles.select} value={permission} onChange={(event) => setPermission(event.target.value as Permission)}>
          {PERMISSIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button className={styles.primary} type="submit" disabled={loading || visible.length === 0}>Add member</button>
      {visible.length === 0 ? <p className={listStyles.empty}>No matching organization members.</p> : null}
      {message ? <p className={styles.alert} role="alert">{message}</p> : null}
    </form>
  );
}

export function JuryServicePermissionControl({
  connectionId,
  memberUserId,
  permission,
}: {
  connectionId: string;
  memberUserId: string;
  permission: Permission;
}) {
  const router = useRouter();
  const [nextPermission, setNextPermission] = useState<Permission>(permission);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('serviceConnectionId', connectionId);
      formData.set('memberUserId', memberUserId);
      formData.set('permission', nextPermission);
      const result = await changeJuryServiceMemberPermission(formData);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    } catch {
      setMessage('Service access could not be changed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={listStyles.controls} onSubmit={handleSave}>
      <label className={styles.field}>
        Permission
        <select className={listStyles.select} value={nextPermission} onChange={(event) => setNextPermission(event.target.value as Permission)}>
          {PERMISSIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button className={styles.primary} type="submit" disabled={loading || nextPermission === permission}>Save permission</button>
      {message ? <p className={styles.alert} role="alert">{message}</p> : null}
    </form>
  );
}

export function JuryServiceRemoveControl({
  connectionId,
  memberUserId,
  email,
  serviceName,
  permissionLabel,
}: {
  connectionId: string;
  memberUserId: string;
  email: string;
  serviceName: string;
  permissionLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRemove = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.set('serviceConnectionId', connectionId);
      formData.set('memberUserId', memberUserId);
      const result = await removeJuryServiceMember(formData);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setMessage('Service access could not be changed');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return <button className={listStyles.remove} type="button" onClick={() => setOpen(true)}>Remove</button>;
  return (
    <div className={listStyles.confirm}>
      <p>Remove service access for:</p>
      <p>{email}</p>
      <p>Service: {serviceName}</p>
      <p>Permission: {permissionLabel}</p>
      {message ? <p className={styles.alert} role="alert">{message}</p> : null}
      <div className={listStyles.confirmActions}>
        <button className={listStyles.remove} type="button" onClick={() => setOpen(false)} disabled={loading}>Cancel</button>
        <button className={styles.primary} type="button" onClick={() => void handleRemove()} disabled={loading}>Remove</button>
      </div>
    </div>
  );
}
