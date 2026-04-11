import type { Metadata } from 'next';
import Script from 'next/script';
import { Syne, DM_Sans, Roboto_Mono } from 'next/font/google';
import { SessionProvider, type InitialSession } from '@/components/SessionProvider';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import './globals.css';

const display = Syne({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['600', '700', '800'],
});

const body = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
});

const mono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
});

const GA_MEASUREMENT_ID = 'G-BH4L4PYCJT';

const siteUrl = 'https://aisleshub.com';

const siteTitle = 'AIsleHub - AI 프롬프트 레시피 & 커뮤니티';

const siteDescription =
  'AI 프롬프트 공유부터 커뮤니티 소통까지, 나만의 AI 레시피를 발견하세요.';

const ogTitle = 'AIsleHub';

const ogDescription = 'AI 프롬프트 공유 및 커뮤니티 플랫폼';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteTitle,
  description: siteDescription,
  keywords: [
    'AIsleHub',
    'AIsle',
    'AI',
    '프롬프트',
    '레시피',
    '커뮤니티',
    'Lab',
    'Gallery',
    'Build',
    'Launch',
    '크리에이터',
  ],
  applicationName: 'AIsleHub',
  authors: [{ name: 'AIsleHub', url: siteUrl }],
  creator: 'AIsleHub',
  publisher: 'AIsleHub',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: siteUrl,
    siteName: 'AIsleHub',
    title: ogTitle,
    description: ogDescription,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'AIsleHub — AI 프롬프트 레시피 & 커뮤니티',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: ogTitle,
    description: ogDescription,
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: siteUrl,
  },
  robots: {
    index: true,
    follow: true,
  },
};

async function getInitialSession(): Promise<InitialSession> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    let dbUsername: string | null = null;
    try {
      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { username: true },
      });
      dbUsername = row?.username ?? null;
    } catch {
      /* DB 일시 오류 시 메타/이메일로 표시 */
    }

    return {
      userId: user.id,
      email: user.email ?? null,
      usernameFromMetadata: (user.user_metadata?.username as string | undefined) ?? null,
      dbUsername,
    };
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialSession = await getInitialSession();

  return (
    <html lang="ko" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className={body.className}>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics-gtag" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
        <SessionProvider initialSession={initialSession}>{children}</SessionProvider>
      </body>
    </html>
  );
}
