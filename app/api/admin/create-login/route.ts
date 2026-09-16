import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAdminClient, requireAdmin, safeErrorMessage } from '../../../../lib/supabaseAdmin';
import { temporaryPassword } from '../../../../lib/throttle';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Gives a profile that has no account (an imported or admin-added one) a way to
// sign in: a new account with an internal sign-in address and a temporary
// password. They then sign in with their email or phone and choose their own.
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: 'Server is not configured yet.' }, { status: 503 });

  let alumniId = '';
  try {
    alumniId = String(((await request.json()) as { alumniId?: string }).alumniId ?? '');
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }
  if (!UUID_RE.test(alumniId)) return NextResponse.json({ error: 'Missing or invalid profile id.' }, { status: 400 });

  const { data: row, error: readErr } = await admin
    .from('alumni').select('user_id, full_name, email_key, phone_key').eq('id', alumniId).maybeSingle();
  if (readErr) return NextResponse.json({ error: `Could not read the profile: ${safeErrorMessage(readErr)}` }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'That profile no longer exists.' }, { status: 404 });
  if (row.user_id) return NextResponse.json({ error: 'This profile already has a login. Use "Reset password".' }, { status: 409 });
  if (!row.email_key && !row.phone_key) {
    return NextResponse.json({ error: 'Add an email or phone number to this profile first — that is what they will sign in with.' }, { status: 409 });
  }

  const password = temporaryPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: `${randomUUID()}@veveaham-alumni-network.com`,
    password,
    email_confirm: true,
    app_metadata: { must_change_password: true },
  });
  if (createErr || !created?.user) {
    return NextResponse.json({ error: `Could not create the login: ${safeErrorMessage(createErr)}` }, { status: 500 });
  }

  const { error: linkErr } = await admin.from('alumni').update({ user_id: created.user.id }).eq('id', alumniId);
  if (linkErr) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    return NextResponse.json({ error: `Could not link the login: ${safeErrorMessage(linkErr)}` }, { status: 500 });
  }
  return NextResponse.json({ name: row.full_name, temporaryPassword: password });
}
