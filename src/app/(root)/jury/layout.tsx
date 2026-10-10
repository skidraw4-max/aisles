import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import styles from './shell.module.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AIsles Jury',
  robots: SEO_ROBOTS_PRIVATE,
};

export const dynamic = 'force-dynamic';

export default function JuryLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${inter.className} ${styles.shell}`}>{children}</div>;
}
