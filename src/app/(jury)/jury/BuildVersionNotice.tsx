'use client';
/**
 * I-098: shows the build this page was rendered by, and asks for a refresh when a newer deployment is live
 * (checked on focus, every 5 minutes, and after a screen audit finishes). UI only; no platform settings.
 * The check omits cookies so it is not pinned to the old deployment.
 */
import * as React from 'react';
import { isStaleBuild } from '@/lib/jury-product/build-version';

export const AUDIT_FINISHED_EVENT = 'jury:audit-finished';

export function BuildVersionNotice(props: { build: string; className?: string }) {
  const [latest, setLatest] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    const check = () => {
      fetch(`/api/jury/build?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { build?: unknown } | null) => {
          if (alive && j && typeof j.build === 'string') setLatest(j.build);
        })
        .catch(() => undefined);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') check();
    };
    check();
    const t = setInterval(check, 5 * 60_000);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener(AUDIT_FINISHED_EVENT, check);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener(AUDIT_FINISHED_EVENT, check);
    };
  }, []);
  const stale = isStaleBuild(props.build, latest);
  return (
    <p className={props.className} role={stale ? 'alert' : undefined} data-build={props.build} style={{ fontSize: 12 }}>
      버전 {props.build}
      {stale ? (
        <>
          {' · '}새 버전({latest})이 배포됐어요. 이 탭은 이전 버전이라 결과가 다를 수 있어요.{' '}
          <button type="button" onClick={() => window.location.reload()} style={{ background: 'none', border: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}>
            새로 고침
          </button>
        </>
      ) : null}
    </p>
  );
}
