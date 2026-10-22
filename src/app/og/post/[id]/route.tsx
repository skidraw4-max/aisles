import type { Category } from '@prisma/client';
import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { loadOgFontData } from '@/lib/og-font';
import { ogStaticFallbackResponse } from '@/lib/og-fallback-response';
import {
  categoryUsesDynamicPostOg,
  dynamicOgBoardSubtitle,
  resolvePostOgThumbnailUrl,
  truncateForOgTitle,
} from '@/lib/post-dynamic-og';

export const runtime = 'nodejs';

const OG_W = 1200;
const OG_H = 630;
const OG_CACHE = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<ImageResponse | NextResponse> {
  try {
    return await renderPostOg(ctx);
  } catch (error) {
    console.error('[og/post] unhandled', {
      step: 'top_level',
      error: error instanceof Error ? error.message : String(error),
    });
    return ogStaticFallbackResponse();
  }
}

async function renderPostOg(
  ctx: { params: Promise<{ id: string }> }
): Promise<ImageResponse | NextResponse> {
  const { id } = await ctx.params;
  const base = getCanonicalSiteUrl();

  if (!id?.trim()) {
    console.warn('[og/post] invalid_post_id', { step: 'validate_params' });
    return ogStaticFallbackResponse();
  }

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
  } catch (error) {
    console.error('[og/post] prisma_failed', {
      step: 'load_post',
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return ogStaticFallbackResponse();
  }

  if (!post || !categoryUsesDynamicPostOg(post.category)) {
    return ogStaticFallbackResponse();
  }

  const fontData = await loadOgFontData();
  if (!fontData) {
    console.warn('[og/post] font_unavailable', { step: 'load_font', id });
    return ogStaticFallbackResponse();
  }

  const safeAttachmentUrls = Array.isArray(post.attachmentUrls)
    ? post.attachmentUrls.filter((url): url is string => typeof url === 'string')
    : [];
  const safePost = {
    ...post,
    title: typeof post.title === 'string' ? post.title : '',
    thumbnail: typeof post.thumbnail === 'string' ? post.thumbnail : null,
    attachmentUrls: safeAttachmentUrls,
  };

  const thumbForImg = resolvePostOgThumbnailUrl(safePost, base);
  const subtitle = dynamicOgBoardSubtitle(post.category);
  const displayTitle = truncateForOgTitle(safePost.title || 'AIsle', 96);

  try {
    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            position: 'relative',
            width: '100%',
            height: '100%',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 48%, #0f172a 100%)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              height: '100%',
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
                  fontFamily: 'Pretendard',
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
                  fontFamily: 'Pretendard',
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
                  fontFamily: 'Pretendard',
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
        fonts: [{ name: 'Pretendard', data: fontData, style: 'normal', weight: 700 }],
        headers: { 'Cache-Control': OG_CACHE },
      }
    );
  } catch (error) {
    console.error('[og/post] render_failed', {
      step: 'render_image',
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return ogStaticFallbackResponse();
  }
}
