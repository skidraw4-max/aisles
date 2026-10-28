'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createJuryOrganization } from '@/app/(jury)/jury/organization/actions';
import { juryHref } from '@/lib/jury-product/jury-url';
import styles from './jury-entry.module.css';

export function JuryOrganizationForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('organizationName', name);
      const result = await createJuryOrganization(formData);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.push(juryHref('/'));
      router.refresh();
    } catch {
      setMessage('조직을 만들 수 없어요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.screen}>
      <div className={styles.frame}>
        <h1 className={styles.brand}>AIsles Jury</h1>
        <p className={styles.studio}>by AIsles Studio</p>
        <h2 className={styles.loginTitle}>조직 만들기</h2>
        <p className={styles.copy}>AIsles Jury를 사용하려면 조직을 만드세요.</p>
        <form className={styles.form} onSubmit={handleCreate}>
          <label className={styles.field}>
            조직 이름
            <input
              name="organizationName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="organization"
              required
            />
          </label>
          {message ? <p className={styles.alert} role="alert">{message}</p> : null}
          <button className={styles.primary} type="submit" disabled={loading}>
            조직 만들기
          </button>
        </form>
      </div>
    </section>
  );
}
