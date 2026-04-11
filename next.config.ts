import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp'],
  /** Vercel 등에서 fs로 읽는 public 파일이 함수 번들에 포함되도록 */
  outputFileTracingIncludes: {
    '/api/posts/upload-image': ['./public/watermark.png'],
    '/api/posts': ['./public/watermark.png'],
  },
};

export default nextConfig;
