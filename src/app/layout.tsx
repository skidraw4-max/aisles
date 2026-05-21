import type { Metadata } from 'next';
import Script from 'next/script';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Syne, DM_Sans, Roboto_Mono } from 'next/font/google';
import { HomeSupabaseRedirectHandler } from '@/components/HomeSupabaseRedirectHandler';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { GA_MEASUREMENT_ID } from '@/lib/ga4';
import { rootLayoutRobots } from '@/lib/seo-robots';
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
  weight: ['400', '500', '700'],
});

const ADSENSE_CLIENT_ID = 'ca-pub-2237287742271246';

const siteUrl = getCanonicalSiteUrl();

const siteTitle = 'AIsle - AI 프롬프트 레시피 & 커뮤니티';

const siteDescription =
  'AI 프롬프트 공유부터 커뮤니티 소통까지, 나만의 AI 레시피를 발견하세요.';

const ogTitle = 'AIsle';

const ogDescription = 'AI 프롬프트 공유 및 커뮤니티 플랫폼';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteTitle,
  description: siteDescription,
  keywords: [
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
  applicationName: 'AIsle',
  authors: [{ name: 'AIsle', url: siteUrl }],
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
    url: siteUrl,
    siteName: 'AIsle',
    title: ogTitle,
    description: ogDescription,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt:
          'AIsle — AI 지식 공유 플랫폼. 프롬프트 레시피(LAB), 갤러리, AI 트렌드·커뮤니티 복도를 한곳에서 탐색할 수 있는 메인 그래픽입니다.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: ogTitle,
    description: ogDescription,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt:
          'AIsle — AI 지식 공유 플랫폼. 프롬프트 레시피(LAB), 갤러리, AI 트렌드·커뮤니티 복도를 한곳에서 탐색할 수 있는 메인 그래픽입니다.',
      },
    ],
  },
  alternates: {
    canonical: siteUrl,
  },
  robots: rootLayoutRobots(),
  ...(() => {
    const google =
      process.env.GOOGLE_SITE_VERIFICATION?.trim() ||
      process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();
    return google
      ? {
          verification: {
            google,
          },
        }
      : {};
  })(),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const siteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'AIsle',
    url: siteUrl,
    description: siteDescription,
    inLanguage: 'ko-KR',
    publisher: {
      '@type': 'Organization',
      name: 'AIsle',
      url: siteUrl,
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <html lang="ko" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className={body.className}>
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
        {GA_MEASUREMENT_ID ? (
          <>
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
          </>
        ) : null}
        <Script
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`}
          strategy="lazyOnload"
          crossOrigin="anonymous"
        />
        <HomeSupabaseRedirectHandler />
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
