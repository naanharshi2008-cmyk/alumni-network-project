import 'server-only';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Server-only Supabase client holding the SERVICE ROLE key.
//
// The service role bypasses row-level security entirely, so this module must
// never reach the browser. Two guards enforce that:
//   1. `import 'server-only'` above - importing this from a client component
//      is a build error, not a runtime surprise.
//   2. The env var deliberately has no NEXT_PUBLIC_ prefix, so Next.js will
//      not inline it into the client bundle.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when the deployment has been given a service role key. */
export const isAdminConfigured = Boolean(supabaseUrl && serviceRoleKey);

/**
 * Returns the privileged client, or null when the key hasn't been configured.
 * Callers must handle null and degrade gracefully - the site has to keep
 * working before these env vars are set in Vercel.
 */
export function getAdminClient(): SupabaseClient | null {
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Staff accounts use this internal email domain. Mirrors app/login/page.tsx. */
export const ADMIN_EMAIL_DOMAIN = 'veveaham-admin.local';

export function isAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase().endsWith(`@${ADMIN_EMAIL_DOMAIN}`));
}

/** What to tell an admin when the deployment's own key is the problem. */
export const SERVICE_KEY_MESSAGE =
  "The site's Supabase service key is missing or invalid, so admin actions cannot run. " +
  'An administrator needs to set SUPABASE_SERVICE_ROLE_KEY in Vercel (Project → Settings → ' +
  'Environment Variables) to the service_role key from Supabase → Project Settings → API keys, ' +
  'pasted as a single line with no spaces or line breaks, then redeploy.';

/**
 * A Supabase error caused by the SERVER's own credentials rather than the
 * caller's. Worth naming, because the two look identical from the outside: an
 * invalid service role key makes every privileged call answer 401, which reads
 * exactly like an expired login.
 */
export function isServiceKeyProblem(error: { message?: string } | null | undefined): boolean {
  const m = error?.message ?? '';
  return (
    /invalid api key/i.test(m) ||
    /no api key/i.test(m) ||
    // A key pasted with a line break in it never reaches Supabase at all: fetch
    // refuses to build the request. Seen in production, where the deployed
    // SUPABASE_SERVICE_ROLE_KEY had a newline in the middle of it.
    /invalid header value/i.test(m) ||
    /header .*(invalid|illegal)/i.test(m)
  );
}

/**
 * An error message safe to hand back over HTTP.
 *
 * Supabase puts the offending value into "invalid header value" errors, so the
 * raw message for a malformed key contained the SERVICE ROLE KEY ITSELF, and
 * the delete route echoed it straight into its JSON response. Credentials must
 * never ride out on an error path, so anything key-shaped is redacted and
 * key-related failures collapse to the actionable message instead.
 */
export function safeErrorMessage(error: { message?: string } | null | undefined): string {
  if (isServiceKeyProblem(error)) return SERVICE_KEY_MESSAGE;
  return (error?.message ?? 'Unknown error')
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_\-]*/g, '[redacted key]')
    .replace(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]*\.?[A-Za-z0-9_\-]*/g, '[redacted token]');
}

/**
 * Verify the caller of an API route is a signed-in admin.
 *
 * The browser sends its Supabase access token; we ask Supabase who it belongs
 * to and check the address. Trusting a client-supplied "I am an admin" flag
 * would be no protection at all, since anyone can craft that request.
 *
 * The token is checked with the PUBLIC anon key on purpose. Validating a JWT
 * needs no privilege, and doing it with the service role meant that a wrong
 * SUPABASE_SERVICE_ROLE_KEY reported "Session is invalid or expired" - blaming
 * the admin's login for a server misconfiguration and sending them off to sign
 * in again, over and over, with nothing to fix at their end. Now a bad server
 * key is reported as a server key problem.
 */
export async function requireAdmin(
  request: Request,
): Promise<{ ok: true; email: string } | { ok: false; status: number; message: string }> {
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 503, message: 'Server is not configured for admin actions yet.' };
  }
  if (!serviceRoleKey) {
    return { ok: false, status: 503, message: SERVICE_KEY_MESSAGE };
  }

  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, message: 'Not signed in.' };

  const publicClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await publicClient.auth.getUser(token);
  if (error || !data?.user) {
    // The anon key is the one the browser itself uses, so if THIS call blames
    // the API key the deployment's public config is broken, not the login.
    if (isServiceKeyProblem(error)) {
      return { ok: false, status: 503, message: 'Server is not configured for admin actions yet.' };
    }
    return { ok: false, status: 401, message: 'Session is invalid or expired.' };
  }
  if (!isAdminEmail(data.user.email)) {
    return { ok: false, status: 403, message: 'This account is not an administrator.' };
  }
  return { ok: true, email: data.user.email! };
}

/**
 * Turn a public storage URL back into the object path so the file can be
 * removed. Photos were never deleted on replace or on profile removal, so the
 * bucket grew forever and a deleted person's picture stayed publicly fetchable.
 */
export function storagePathFromPublicUrl(url: string | null | undefined, bucket = 'photos'): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = url.slice(idx + marker.length).split('?')[0];
  return path ? decodeURIComponent(path) : null;
}
