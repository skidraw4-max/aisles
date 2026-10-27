import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import styles from './shell.module.css';

// Self-hosted Inter (OFL, see src/app/fonts) so the build never downloads fonts from Google.
const inter = localFont({
  src: [{ path: '../../fonts/Inter-latin-var.woff2', weight: '100 900', style: 'normal' }],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AIsles Jury',
  robots: SEO_ROBOTS_PRIVATE,
};

export const dynamic = 'force-dynamic';
/** D-06 (A): Jury review server actions run in-function; 300s (Vercel Pro) > JURY_LLM_TOTAL_BUDGET_MS 240s so a budget overrun is recorded as FAILED instead of a platform 504. */
export const maxDuration = 300;

export default function JuryLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${inter.className} ${styles.shell}`}>{children}</div>;
}
