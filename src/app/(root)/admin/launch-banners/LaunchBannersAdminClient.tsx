'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  setLaunchBannerAdminAction,
  unfeatureLaunchBannerAdminAction,
} from './actions';
import type { LaunchBannerAdminRow } from '@/lib/ugc-hub.shared';
import styles from './launch-banners-admin.module.css';

type Props = {
  active: LaunchBannerAdminRow[];
  candidates: LaunchBannerAdminRow[];
};

function defaultExpiryIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 16);
}

function BannerTable({
  rows,
  mode,
  onDone,
}: {
  rows: LaunchBannerAdminRow[];
  mode: 'active' | 'candidate';
  onDone: (msg: string, ok: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [expiryById, setExpiryById] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const r of rows) {
      init[r.id] = r.launchBannerUntil?.slice(0, 16) ?? defaultExpiryIso();
    }
    return init;
  });

  if (rows.length === 0) {
    return <p className={styles.empty}>{mode === 'active' ? '노출 중인 배너가 없습니다.' : '검토 후보가 없습니다.'}</p>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>제목</th>
          <th>조회</th>
          <th>♥</th>
          <th>만료</th>
          <th>동작</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <Link href={`/post/${row.id}`}>{row.title}</Link>
              {!row.hasThumbnail ? (
                <span style={{ marginLeft: 6, fontSize: '0.75rem', opacity: 0.7 }}>(썸네일 없음)</span>
              ) : null}
            </td>
            <td>{row.views}</td>
            <td>{row.likeCount}</td>
            <td>
              {mode === 'active' || mode === 'candidate' ? (
                <input
                  type="datetime-local"
                  className={styles.dateInput}
                  value={expiryById[row.id] ?? ''}
                  onChange={(e) =>
                    setExpiryById((prev) => ({ ...prev, [row.id]: e.target.value }))
                  }
                  disabled={pending}
                />
              ) : null}
            </td>
            <td>
              <div className={styles.rowActions}>
                {mode === 'candidate' ? (
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={pending}
                    onClick={() => {
                      startTransition(async () => {
                        const until = expiryById[row.id]
                          ? new Date(expiryById[row.id]).toISOString()
                          : null;
                        const r = await setLaunchBannerAdminAction({
                          postId: row.id,
                          featuredOnHome: true,
                          launchBannerUntil: until,
                        });
                        onDone(r.ok ? '배너에 등록했습니다.' : r.error, r.ok);
                      });
                    }}
                  >
                    배너 등록
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.btn}
                      disabled={pending}
                      onClick={() => {
                        startTransition(async () => {
                          const until = expiryById[row.id]
                            ? new Date(expiryById[row.id]).toISOString()
                            : null;
                          const r = await setLaunchBannerAdminAction({
                            postId: row.id,
                            featuredOnHome: true,
                            launchBannerUntil: until,
                          });
                          onDone(r.ok ? '만료일을 저장했습니다.' : r.error, r.ok);
                        });
                      }}
                    >
                      만료 저장
                    </button>
                    <button
                      type="button"
                      className={styles.btnDanger}
                      disabled={pending}
                      onClick={() => {
                        startTransition(async () => {
                          const r = await unfeatureLaunchBannerAdminAction(row.id);
                          onDone(r.ok ? '배너에서 내렸습니다.' : r.error, r.ok);
                        });
                      }}
                    >
                      배너 해제
                    </button>
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LaunchBannersAdminClient({ active, candidates }: Props) {
  const router = useRouter();
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  const onDone = (text: string, ok: boolean) => {
    setFlash({ text, ok });
    if (ok) router.refresh();
  };

  return (
    <div className={styles.inner}>
      <Link href="/notices/admin" className={styles.back}>
        ← 공지 관리
      </Link>
      <h1 className={styles.title}>LAUNCH 메인 배너</h1>
      <p className={styles.lead}>
        메인 홈 슬라이더(최대 3건). LAUNCH 글만 등록할 수 있습니다. 만료일이 지나면 자동으로 노출되지 않습니다.
      </p>
      {flash ? (
        <p className={flash.ok ? styles.msgOk : styles.msgErr} role="status">
          {flash.text}
        </p>
      ) : null}
      <section>
        <h2 className={styles.sectionTitle}>노출 중</h2>
        <BannerTable rows={active} mode="active" onDone={onDone} />
      </section>
      <section>
        <h2 className={styles.sectionTitle}>검토 후보 (썸네일·본문 충족)</h2>
        <BannerTable rows={candidates} mode="candidate" onDone={onDone} />
      </section>
    </div>
  );
}
