import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeErrorMessage } from './supabaseAdmin';
import { temporaryPassword } from './throttle';

export const ALUMNI_LOGIN_DOMAIN = 'veveaham-alumni-network.com';

/**
 * Give a profile with no account a way in.
 *
 * The address is an opaque handle nobody ever types: people sign in with the
 * email or phone on their profile, which `login_handle` maps to this. The
 * password is temporary and flagged, so the first sign-in goes straight to
 * choosing a real one.
 *
 * Shared by "Create login" on an existing profile and by the school adding
 * someone itself, so both can only ever issue credentials the same way.
 */
export async function issueLogin(
  admin: SupabaseClient,
  alumniId: string,
): Promise<{ ok: true; temporaryPassword: string } | { ok: false; status: number; error: string }> {
  const password = temporaryPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: `${randomUUID()}@${ALUMNI_LOGIN_DOMAIN}`,
    password,
    email_confirm: true,
    app_metadata: { must_change_password: true },
  });
  if (createErr || !created?.user) {
    return { ok: false, status: 500, error: `Could not create the login: ${safeErrorMessage(createErr)}` };
  }

  const { error: linkErr } = await admin.from('alumni').update({ user_id: created.user.id }).eq('id', alumniId);
  if (linkErr) {
    // An orphan auth user would hold the handle and never be reachable.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    return { ok: false, status: 500, error: `Could not link the login: ${safeErrorMessage(linkErr)}` };
  }
  return { ok: true, temporaryPassword: password };
}
