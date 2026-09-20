import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * A Supabase client for pages that render on the server.
 *
 * It uses the ANON key, deliberately. That is exactly the privilege every
 * visitor's browser already holds, and the public_alumni view is granted to
 * anon precisely so that this read is safe: the contact columns are not in
 * the view, so they cannot be selected by accident.
 *
 * The service-role client in lib/supabaseAdmin.ts must never be used from a
 * public page. It bypasses row-level security entirely, and the whole privacy
 * posture of migration 02 rests on it staying out of read paths a visitor can
 * reach - one mistyped select would publish everyone's phone number.
 *
 * Separate from lib/supabaseClient.ts because that one is a module-level
 * singleton with session persistence on, which is the wrong shape to share
 * across concurrent requests on a server.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isServerSupabaseConfigured = Boolean(url && anon);

export const supabaseServer = createClient(url || 'http://localhost', anon || 'anon', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
