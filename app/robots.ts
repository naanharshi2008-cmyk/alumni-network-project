import type { MetadataRoute } from 'next';
import { siteOrigin } from '../lib/site';

/**
 * The public half of the site is meant to be found: a junior searching for a
 * college, or for a senior they have heard of, should be able to land here.
 *
 * The admin and the API are disallowed outright. The private pages are not
 * listed here on purpose - a disallowed page is never fetched, so a noindex
 * on it is never read, and the URL can still end up indexed from a link
 * somewhere. Those carry an X-Robots-Tag header instead (see middleware.ts).
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin'] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
