'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { acceptJuryInvitation } from '@/app/(jury)/jury/invitation/actions';
import { juryHref } from '@/lib/jury-product/jury-url';
import styles from './jury-entry.module.css';

export function JuryInvitationAccept({
  token,
  organizationName,
  email,
}: {
  token: string;
  organizationName: string;
  email: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAccept = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('token', token);
      const result = await acceptJuryInvitation(formData);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.push(juryHref('/'));
      router.refresh();
    } catch {
      setMessage('유효하지 않은 초대');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleAccept}>
      <p className={styles.copy}>
        참여 <strong>{organizationName}</strong> as {email}.
      </p>
      {message ? <p className={styles.alert} role="alert">{message}</p> : null}
      <button className={styles.primary} type="submit" disabled={loading}>초대 수락</button>
      <p className={styles.signup}>
        <Link className={styles.textLink} href={juryHref('/')}>Jury 홈</Link>
      </p>
    </form>
  );
}
