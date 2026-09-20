import type { MetadataRoute } from 'next';
import { fetchSitemapRows } from '../lib/publicData';
import { siteOrigin } from '../lib/site';

/**
 * Every page worth finding, and nothing else.
 *
 * The colleges listed are only those an approved alumnus actually attends,
 * derived from the alumni exactly as /colleges derives its own grid. The
 * colleges table holds about 47,000 rows; listing them all would be a sitemap
 * mostly of pages with nobody on them, which is the textbook definition of
 * thin content and would work against the profile pages that matter.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const now = new Date();

  const statics: MetadataRoute.Sitemap = [
    { url: `${origin}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${origin}/directory`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${origin}/colleges`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${origin}/about`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${origin}/register`, lastModified: now, changeFrequency: 'yearly', priority: 0.6 },
  ];

  const rows = await fetchSitemapRows();

  const people: MetadataRoute.Sitemap = rows
    .filter((r) => r.public_slug)
    .map((r) => ({
      url: `${origin}/alumni/${r.public_slug}`,
      lastModified: r.last_updated ?? r.last_confirmed_at ?? undefined,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    }));

  const colleges: MetadataRoute.Sitemap = [...new Set(rows.map((r) => r.college_id).filter(Boolean))]
    .map((id) => ({
      url: `${origin}/colleges/${id}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    }));

  return [...statics, ...people, ...colleges];
}
