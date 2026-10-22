'use client';

import { useSearchParams } from 'next/navigation';
import styles from './SiteHeader.module.css';

/** 헤더 검색 — GET /search?q=… (검색 결과 페이지와 쿼리 동기화) */
export function HeaderSearch() {
  const sp = useSearchParams();
  const q = sp.get('q')?.trim() ?? '';
  const tag = sp.get('tag')?.trim() ?? '';

  return (
    <form
      className={styles.search}
      action="/search"
      method="get"
      role="search"
      key={`${q}|${tag}`}
    >
      {tag ? <input type="hidden" name="tag" value={tag} /> : null}
      <button type="submit" className={styles.searchSubmit} aria-label="검색 실행">
        <span className={styles.searchIcon} aria-hidden>
          ⌕
        </span>
      </button>
      <input
        name="q"
        type="search"
        placeholder="제목, 본문, 작성자 검색…"
        aria-label="검색"
        defaultValue={q}
        autoComplete="off"
        maxLength={120}
      />
    </form>
  );
}
