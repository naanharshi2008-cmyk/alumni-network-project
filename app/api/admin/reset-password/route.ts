import { NextResponse } from 'next/server';
import { getAdminClient, requireAdmin, safeErrorMessage } from '../../../../lib/supabaseAdmin';
import { temporaryPassword } from '../../../../lib/throttle';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// An admin sets a temporary password for someone who is locked out - the path
// that works even before school email is set up. The password is returned once,
// for the admin to pass on, and the account must choose a new one at next login.
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
    .from('alumni').select('user_id, full_name').eq('id', alumniId).maybeSingle();
  if (readErr) return NextResponse.json({ error: `Could not read the profile: ${safeErrorMessage(readErr)}` }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'That profile no longer exists.' }, { status: 404 });
  if (!row.user_id) {
    return NextResponse.json({ error: 'This profile has no login yet. Use "Create login" instead.' }, { status: 409 });
  }

  const { data: existing } = await admin.auth.admin.getUserById(row.user_id);
  const password = temporaryPassword();
  const { error } = await admin.auth.admin.updateUserById(row.user_id, {
    password,
    app_metadata: { ...(existing?.user?.app_metadata ?? {}), must_change_password: true },
  });
  if (error) return NextResponse.json({ error: `Could not reset the password: ${safeErrorMessage(error)}` }, { status: 500 });

  return NextResponse.json({ name: row.full_name, temporaryPassword: password });
}
