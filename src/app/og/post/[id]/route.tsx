import type { Category } from '@prisma/client';
import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import {
  categoryUsesDynamicPostOg,
  dynamicOgBoardSubtitle,
  resolvePostOgThumbnailUrl,
  truncateForOgTitle,
} from '@/lib/post-dynamic-og';

export const runtime = 'nodejs';

const OG_W = 1200;
const OG_H = 630;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<ImageResponse | NextResponse> {
  const { id } = await ctx.params;
  const base = getCanonicalSiteUrl();
  const defaultOg = new URL('/og-image.png', base).href;

  let post: {
    title: string;
    category: Category;
    thumbnail: string | null;
    attachmentUrls: string[];
  } | null;

  try {
    post = await prisma.post.findUnique({
      where: { id },
      select: {
        title: true,
        category: true,
        thumbnail: true,
        attachmentUrls: true,
      },
    });
  } catch {
    post = null;
  }

  if (!post || !categoryUsesDynamicPostOg(post.category)) {
    return NextResponse.redirect(new URL('/og-image.png', base));
  }

  let fontData: ArrayBuffer | undefined;
  try {
    const fr = await fetch(
      'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/Pretendard-Bold.woff2'
    );
    if (fr.ok) fontData = await fr.arrayBuffer();
  } catch {
    fontData = undefined;
  }

  const thumbUrl = resolvePostOgThumbnailUrl(post, base);
  const thumbForImg = thumbUrl ?? null;
  const subtitle = dynamicOgBoardSubtitle(post.category);
  const displayTitle = truncateForOgTitle(post.title, 96);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: '#0f172a',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- @vercel/og Satori */}
        <img
          src={defaultOg}
          width={OG_W}
          height={OG_H}
          alt=""
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            objectFit: 'cover',
            width: OG_W,
            height: OG_H,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: OG_W,
            height: OG_H,
            background:
              'linear-gradient(90deg, rgba(15,23,42,0.84) 0%, rgba(15,23,42,0.5) 52%, rgba(15,23,42,0.28) 100%)',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '44px 52px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
              maxWidth: thumbForImg ? 700 : 980,
              gap: 14,
            }}
          >
            <div
              style={{
                fontFamily: fontData ? 'Pretendard' : 'system-ui, sans-serif',
                fontSize: 50,
                fontWeight: 700,
                color: '#ffffff',
                lineHeight: 1.22,
                letterSpacing: '-0.02em',
              }}
            >
              {displayTitle}
            </div>
            <div
              style={{
                fontFamily: fontData ? 'Pretendard' : 'system-ui, sans-serif',
                fontSize: 26,
                color: 'rgba(255,255,255,0.88)',
                fontWeight: 600,
              }}
            >
              {subtitle}
            </div>
          </div>
          {thumbForImg ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 28,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- @vercel/og Satori */}
              <img
                src={thumbForImg}
                width={360}
                height={360}
                alt=""
                style={{
                  borderRadius: 18,
                  objectFit: 'cover',
                  border: '4px solid rgba(255,255,255,0.92)',
                  boxShadow: '0 16px 44px rgba(0,0,0,0.38)',
                }}
              />
            </div>
          ) : (
            <div
              style={{
                width: 360,
                height: 360,
                marginLeft: 28,
                borderRadius: 18,
                border: '4px dashed rgba(255,255,255,0.32)',
                background: 'rgba(255,255,255,0.07)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.55)',
                fontFamily: fontData ? 'Pretendard' : 'system-ui, sans-serif',
                fontSize: 44,
                fontWeight: 700,
              }}
            >
              AIsle
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: OG_W,
      height: OG_H,
      ...(fontData
        ? {
            fonts: [{ name: 'Pretendard', data: fontData, style: 'normal' as const, weight: 700 as const }],
          }
        : {}),
    }
  );
}
