import type { NextConfig } from 'next';
import { buildImageRemotePatterns } from './src/lib/next-image-remote-patterns';
import { RESOURCE_NOINDEX_HEADER } from './src/lib/seo-resource-headers';

const nextConfig: NextConfig = {
  /** 게시판 목록 조회수·댓글 수가 뒤로 가기 등에서 오래된 RSC 캐시로 남지 않도록 */
  experimental: {
    staleTimes: {
      /** 조회수 증분은 post `after()` + 클라 +1. 탭 전환마다 RSC 재요청하지 않도록 완화 */
      dynamic: 30,
      static: 180,
    },
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: buildImageRemotePatterns(),
  },
  serverExternalPackages: ['sharp'],
  /** Vercel 등에서 fs로 읽는 파일이 함수 번들에 포함되도록 */
  outputFileTracingIncludes: {
    '/api/posts/upload-image': ['./public/watermark.png'],
    '/api/posts': ['./public/watermark.png'],
    '/og/post/[id]': ['./public/fonts/Pretendard-Bold.otf', './public/og-image.png'],
    /** AI Review Board: run JSON은 import가 아니라 fs로 읽음 → tracing에 명시 필요 */
    '/admin/ai-review-board': ['./data/ai-review-board/**/*'],
    '/admin/ai-review-board/[runId]': ['./data/ai-review-board/**/*'],
  },
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [RESOURCE_NOINDEX_HEADER],
      },
      {
        source: '/og-image.png',
        headers: [RESOURCE_NOINDEX_HEADER],
      },
    ];
  },
};

export default nextConfig;
