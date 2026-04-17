'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/SessionProvider';
import { Menu, Plus } from 'lucide-react';
import { AuthModal } from './AuthModal';
import { MainNav, MainNavFallback, MobileMainNavPanel, MobileMainNavPanelFallback } from './MainNav';
import { HeaderSearch } from './HeaderSearch';
import styles from './SiteHeader.module.css';

export function SiteHeader() {
  const router = useRouter();
  const { isAuthenticated, displayName } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mainNavOpen, setMainNavOpen] = useState(false);
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
          <div className={styles.leftBrand}>
            <button
              type="button"
              className={styles.mobileNavToggle}
              aria-label="주요 메뉴 열기"
              aria-expanded={mainNavOpen}
              aria-controls="mobile-main-nav-panel"
              onClick={() => setMainNavOpen(true)}
            >
              <Menu className="h-5 w-5" strokeWidth={2} aria-hidden />
            </button>
            <Link href="/" className={styles.logo}>
              AIsle
            </Link>
          </div>
          <Suspense fallback={<MainNavFallback />}>
            <MainNav />
          </Suspense>
          <div className={styles.right}>
            <Suspense fallback={<div className={styles.searchFallback} aria-hidden />}>
              <HeaderSearch />
            </Suspense>
            {isAuthenticated ? (
              <div className={styles.userRow}>
                <Link href="/upload" className={styles.uploadLink} aria-label="레시피 등록">
                  <Plus className={styles.uploadLinkIcon} strokeWidth={2.25} size={18} aria-hidden />
                  <span className={styles.uploadLinkLabel}>레시피 등록</span>
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
                        레시피 등록
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
      {mainNavOpen ? (
        <Suspense
          fallback={<MobileMainNavPanelFallback onClose={() => setMainNavOpen(false)} />}
        >
          <MobileMainNavPanel onClose={() => setMainNavOpen(false)} />
        </Suspense>
      ) : null}
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
