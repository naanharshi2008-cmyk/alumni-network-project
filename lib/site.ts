/**
 * Where this site lives, as one answer.
 *
 * Every absolute URL the site emits - canonical links, Open Graph tags, the
 * sitemap, the address printed on a shared preview card, the links inside
 * emails - resolves through here, so moving to the school's own domain is one
 * environment variable rather than a search through the codebase.
 *
 * The order matters:
 *   1. NEXT_PUBLIC_SITE_URL, when someone has said it explicitly.
 *   2. On a preview deployment, that deployment's own host. Without this,
 *      every preview emits URLs pointing at production and you spend an
 *      afternoon chasing a preview bug that is not there.
 *   3. The project's production domain, which Vercel keeps current by itself -
 *      so attaching a new domain moves the site even if nobody remembers to
 *      update the variable.
 *   4. Local development.
 *
 * Neither Vercel variable carries a scheme, hence the prefix.
 */
export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return 'http://localhost:3000';
}

/** The origin without its scheme, for printing on a card or in an email. */
export function siteHost(): string {
  return siteOrigin().replace(/^https?:\/\//, '');
}
