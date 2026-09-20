import { NextResponse, type NextRequest } from 'next/server';

/**
 * Two jobs, both of which have to happen before a page renders.
 *
 * 1. Keep the private half of the site out of search results. Every one of
 *    those pages is a client component, and a client component cannot export
 *    `metadata` - so the alternative was six new server layouts whose only
 *    content was a robots directive. A response header does the same job and
 *    Google treats it identically.
 *
 *    /register is deliberately NOT here: it is the page a parent should reach
 *    after reading a senior's profile.
 *
 * 2. Send the old share links somewhere real. Profiles used to live at
 *    /directory?p=<slug>, and those links are already sitting in WhatsApp
 *    groups. A redirect here means a crawler following an old link lands on
 *    the page with the preview card, rather than on a page that would have to
 *    redirect it again from the browser.
 */

const PRIVATE = [
  '/profile', '/login', '/reset-password', '/verify-email', '/forgot-password', '/admin',
];

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (pathname === '/directory') {
    const slug = searchParams.get('p');
    if (slug) {
      const to = request.nextUrl.clone();
      to.pathname = `/alumni/${encodeURIComponent(slug)}`;
      to.search = '';
      return NextResponse.redirect(to, 308);
    }
  }

  const response = NextResponse.next();
  if (PRIVATE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return response;
}

export const config = {
  matcher: [
    '/directory',
    '/profile/:path*', '/login/:path*', '/reset-password/:path*',
    '/verify-email/:path*', '/forgot-password/:path*', '/admin/:path*',
  ],
};
