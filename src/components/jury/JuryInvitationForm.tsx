'use client';

import { useState } from 'react';
import { createJuryInvitation } from '@/app/(root)/jury/organization/invitations/actions';
import styles from './jury-entry.module.css';
import listStyles from './invitation.module.css';

const INVITE_ROLES = ['ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER'] as const;

export function JuryInvitationForm() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>('VIEWER');
  const [message, setMessage] = useState<string | null>(null);
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setInvitationUrl(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('email', email);
      formData.set('role', role);
      const result = await createJuryInvitation(formData);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setInvitationUrl(result.invitationUrl);
      setEmail('');
      setRole('VIEWER');
    } catch {
      setMessage('Invitation creation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleInvite}>
      <h2 className={styles.loginTitle}>Invite member</h2>
      <label className={styles.field}>
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label className={styles.field}>
        Role
        <select className={listStyles.select} name="role" value={role} onChange={(event) => setRole(event.target.value as (typeof INVITE_ROLES)[number])}>
          {INVITE_ROLES.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>
      {message ? <p className={styles.alert} role="alert">{message}</p> : null}
      {invitationUrl ? (
        <label className={styles.field}>
          Invitation link
          <input readOnly value={invitationUrl} aria-label="Invitation link" />
        </label>
      ) : null}
      <button className={styles.primary} type="submit" disabled={loading}>Send invitation</button>
    </form>
  );
}
