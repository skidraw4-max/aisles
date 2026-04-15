import type { MetadataRoute } from 'next';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';

export default function robots(): MetadataRoute.Robots {
  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/notices/admin'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
