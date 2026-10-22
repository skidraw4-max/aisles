import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';

const OG_IMAGE_CACHE = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800';

let cachedPng: Buffer | null = null;

/** 동적 OG 합성 실패 시 정적 og-image.png 직접 반환(리다이렉트 대신 — 크롤러·캐시 친화) */
export async function ogStaticFallbackResponse(): Promise<NextResponse> {
  try {
    if (!cachedPng) {
      cachedPng = await readFile(join(process.cwd(), 'public/og-image.png'));
    }
    return new NextResponse(new Uint8Array(cachedPng), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': OG_IMAGE_CACHE,
      },
    });
  } catch {
    const base = getCanonicalSiteUrl();
    return NextResponse.redirect(new URL('/og-image.png', base), 307);
  }
}
