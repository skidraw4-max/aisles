type RemotePattern = {
  protocol: 'http' | 'https';
  hostname: string;
  pathname: string;
};

/** next/image 허용 호스트 — R2·Supabase 등 업로드 미디어 */
export function buildImageRemotePatterns(): RemotePattern[] {
  const fromEnv = (key: string): RemotePattern | null => {
    const v = process.env[key]?.trim();
    if (!v) return null;
    try {
      const u = new URL(v.includes('://') ? v : `https://${v}`);
      return { protocol: 'https', hostname: u.hostname, pathname: '/**' };
    } catch {
      return null;
    }
  };

  const patterns: RemotePattern[] = [
    { protocol: 'https', hostname: 'img.aisleshub.com', pathname: '/**' },
    { protocol: 'https', hostname: '*.r2.dev', pathname: '/**' },
    { protocol: 'https', hostname: '**.supabase.co', pathname: '/**' },
    { protocol: 'https', hostname: '**.amazonaws.com', pathname: '/**' },
    { protocol: 'https', hostname: '**.googleusercontent.com', pathname: '/**' },
  ];

  for (const key of ['NEXT_PUBLIC_R2_PUBLIC_URL', 'R2_PUBLIC_BASE_URL', 'R2_PUBLIC_DOMAIN'] as const) {
    const p = fromEnv(key);
    if (p) patterns.push(p);
  }

  return patterns;
}
