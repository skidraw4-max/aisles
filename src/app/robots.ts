import type { MetadataRoute } from 'next';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';

export default function robots(): MetadataRoute.Robots {
  const base = getCanonicalSiteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/login', '/profile', '/my-aisles', '/upload', '/write', '/auth/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
