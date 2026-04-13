'use client';

import Link from 'next/link';
import { useAuth } from '@/components/SessionProvider';
import styles from './NoticeAdminLink.module.css';

/** 관리자에게만 노출되는 공지 관리 진입 링크 (클라이언트 role 기준) */
export function NoticeAdminLink() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return null;
  return (
    <Link href="/notices/admin" className={styles.link}>
      공지 관리
    </Link>
  );
}
