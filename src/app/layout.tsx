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

export const metadata: Metadata = {
  title: 'AIsle — Lab · Gallery · Build · Launch',
  description: 'AI 프롬프트, 비주얼, 빌드, 런치를 한 복도에서.',
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
