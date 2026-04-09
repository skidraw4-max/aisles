import type { Metadata } from 'next';
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

const siteTitle = 'AIsle - AI Recipe & Project Hub';

const siteDescription =
  '프롬프트 레시피(Lab)부터 비주얼 갤러리, 빌드 노트, AI 서비스 런치까지—네 개의 복도에서 영감을 모으고 작품을 완성하세요. 크리에이터와 빌더를 위한 AI 허브, AIsle.';

export const metadata: Metadata = {
  metadataBase: new URL('https://aisles.kr'),
  title: siteTitle,
  description: siteDescription,
  keywords: [
    'AIsle',
    'AI',
    '프롬프트',
    '레시피',
    'Lab',
    'Gallery',
    'Build',
    'Launch',
    '크리에이터',
    '프로젝트 허브',
  ],
  applicationName: 'AIsle',
  authors: [{ name: 'AIsle', url: 'https://aisles.kr' }],
  creator: 'AIsle',
  publisher: 'AIsle',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: 'https://aisles.kr',
    siteName: 'AIsle',
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'AIsle — Lab · Gallery · Build · Launch',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
    images: ['/twitter-image'],
  },
  alternates: {
    canonical: 'https://aisles.kr',
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
        <SessionProvider initialSession={initialSession}>{children}</SessionProvider>
      </body>
    </html>
  );
}
