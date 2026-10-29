import type { Metadata } from 'next';
import { isJuryHost } from './jury-host';
import { juryAppOrigin } from './jury-url';

export const JURY_OG_IMAGE_PATH = '/jury/og-image.png';

export const JURY_OG_IMAGE_ALT =
  'AIsles Jury — AI 서비스를 근거 기반으로 심사·개선·재심사하는 플랫폼 미리보기 이미지';

/** Match middleware host resolution for metadata. */
export function requestHostname(hostHeader: string | null, forwardedHost: string | null): string {
  const host = forwardedHost?.split(',')[0]?.trim() || hostHeader || '';
  return host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/** Open Graph for jury.aisleshub.com only; hub /jury paths keep the root AIsle preview. */
export function juryHostOpenGraphMetadata(hostname: string): Metadata | null {
  if (!isJuryHost(hostname)) return null;
  const origin = juryAppOrigin() ?? `https://${hostname}`;
  const title = 'AIsles Jury';
  const description =
    '연결한 서비스 근거로 AI 심사를 실행하고, 개선과 재심사까지 품질 결정을 기록합니다.';
  const ogDescription =
    'Verify. Improve. Review Again. — AI service review on collected evidence.';
  const image = {
    url: JURY_OG_IMAGE_PATH,
    width: 1200,
    height: 630,
    alt: JURY_OG_IMAGE_ALT,
  };
  return {
    metadataBase: new URL(origin),
    title,
    description,
    applicationName: 'AIsles Jury',
    openGraph: {
      type: 'website',
      locale: 'ko_KR',
      url: origin,
      siteName: 'AIsles Jury',
      title,
      description: ogDescription,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: ogDescription,
      images: [image],
    },
    alternates: {
      canonical: origin,
    },
  };
}
