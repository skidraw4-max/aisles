'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/SessionProvider';
import { AuthModal } from './AuthModal';
import { MainNav, MainNavFallback } from './MainNav';
import { HeaderSearch } from './HeaderSearch';
import styles from './SiteHeader.module.css';

export function SiteHeader() {
  const router = useRouter();
  const { isAuthenticated, displayName } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link href="/" className={styles.logo}>
            AIsle
          </Link>
          <Suspense fallback={<MainNavFallback />}>
            <MainNav />
          </Suspense>
          <div className={styles.right}>
            <Suspense fallback={<div className={styles.searchFallback} aria-hidden />}>
              <HeaderSearch />
            </Suspense>
            {isAuthenticated ? (
              <div className={styles.userRow}>
                <Link href="/upload" className={styles.uploadLink}>
                  업로드
                </Link>
                <div className={styles.userMenu} ref={menuRef}>
                  <button
                    type="button"
                    className={styles.userMenuTrigger}
                    aria-expanded={menuOpen}
                    aria-haspopup="true"
                    aria-controls="user-menu-panel"
                    id="user-menu-button"
                    onClick={() => setMenuOpen((o) => !o)}
                  >
                    <span className={styles.userMenuName}>
                      {displayName || 'User'}
                    </span>
                    <span className={styles.userMenuChevron} aria-hidden>
                      ▾
                    </span>
                  </button>
                  {menuOpen ? (
                    <div
                      className={styles.userMenuPanel}
                      id="user-menu-panel"
                      role="menu"
                      aria-labelledby="user-menu-button"
                    >
                      <Link
                        href="/profile"
                        className={styles.userMenuItem}
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                      >
                        프로필
                      </Link>
                      <Link
                        href="/my-aisles"
                        className={styles.userMenuItem}
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                      >
                        My Aisles
                      </Link>
                      <Link
                        href="/upload"
                        className={styles.userMenuItem}
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                      >
                        업로드
                      </Link>
                      <button
                        type="button"
                        className={styles.userMenuLogout}
                        role="menuitem"
                        onClick={() => void handleLogout()}
                      >
                        Logout
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <button type="button" className={styles.login} onClick={() => setModalOpen(true)}>
                Login
              </button>
            )}
          </div>
        </div>
      </header>
      <AuthModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAuthed={() => {
          setModalOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
