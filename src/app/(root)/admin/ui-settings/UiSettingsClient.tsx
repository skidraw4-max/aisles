'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { saveUiConfigAction } from './actions';
import styles from './ui-settings.module.css';

export type UiSettingsRow = {
  key: string;
  value: string;
  description: string;
};

type Props = {
  rows: UiSettingsRow[];
};

export function UiSettingsClient({ rows: initialRows }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  const dirty = useMemo(() => {
    return rows.some((r, i) => r.value !== initialRows[i]?.value);
  }, [rows, initialRows]);

  const updateValue = (key: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, value } : r)));
    setMessage(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const updates = rows
      .map((r, i) => ({ key: r.key, value: r.value, prev: initialRows[i]?.value }))
      .filter((x) => x.value !== x.prev);
    if (updates.length === 0) {
      setMessage({ type: 'ok', text: '변경된 항목이 없습니다.' });
      return;
    }
    startTransition(() => {
      void saveUiConfigAction(updates.map(({ key, value }) => ({ key, value }))).then((res) => {
        if (res.ok) {
          setMessage({ type: 'ok', text: '저장했습니다. 메인 등에 반영되었습니다.' });
          router.refresh();
        } else {
          setMessage({ type: 'err', text: res.error });
        }
      });
    });
  };

  return (
    <>
      <Link href="/" className={styles.back}>
        ← 홈으로
      </Link>
      <main className={styles.main}>
        <h1 className={styles.title}>UI 문구 설정</h1>
        <p className={styles.lead}>
          메뉴명·헤드라인·탭·홈 섹션 등에 쓰이는 문구를 수정합니다. 저장 후 메인 페이지 캐시가 갱신됩니다.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          {rows.map((row) => (
            <div key={row.key} className={styles.row}>
              <div className={styles.key}>{row.key}</div>
              <div className={styles.desc}>{row.description}</div>
              <textarea
                className={styles.textarea}
                name={row.key}
                value={row.value}
                onChange={(e) => updateValue(row.key, e.target.value)}
                rows={row.value.length > 120 ? 4 : 2}
                spellCheck={false}
              />
            </div>
          ))}

          <div className={styles.actions}>
            <button type="submit" className={styles.saveBtn} disabled={isPending || !dirty}>
              {isPending ? '저장 중…' : '변경 사항 저장'}
            </button>
            {message ? (
              <span
                className={`${styles.msg} ${message.type === 'ok' ? styles.msgOk : styles.msgErr}`}
                role="status"
              >
                {message.text}
              </span>
            ) : null}
          </div>
        </form>
      </main>
    </>
  );
}
