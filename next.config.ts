import type { NextConfig } from 'next';
import { buildImageRemotePatterns } from './src/lib/next-image-remote-patterns';

const nextConfig: NextConfig = {
  /** 게시판 목록 조회수·댓글 수가 뒤로 가기 등에서 오래된 RSC 캐시로 남지 않도록 */
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 180,
    },
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: buildImageRemotePatterns(),
  },
  serverExternalPackages: ['sharp'],
  /** Vercel 등에서 fs로 읽는 public 파일이 함수 번들에 포함되도록 */
  outputFileTracingIncludes: {
    '/api/posts/upload-image': ['./public/watermark.png'],
    '/api/posts': ['./public/watermark.png'],
    '/og/post/[id]': ['./public/fonts/Pretendard-Bold.otf', './public/og-image.png'],
  },
};

export default nextConfig;
