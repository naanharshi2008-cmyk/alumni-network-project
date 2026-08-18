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

/**
 * Verify the caller of an API route is a signed-in admin.
 *
 * The browser sends its Supabase access token; we ask Supabase who it belongs
 * to and check the address. Trusting a client-supplied "I am an admin" flag
 * would be no protection at all, since anyone can craft that request.
 */
export async function requireAdmin(
  request: Request,
): Promise<{ ok: true; email: string } | { ok: false; status: number; message: string }> {
  const admin = getAdminClient();
  if (!admin) {
    return { ok: false, status: 503, message: 'Server is not configured for admin actions yet.' };
  }

  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, message: 'Not signed in.' };

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { ok: false, status: 401, message: 'Session is invalid or expired.' };
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
