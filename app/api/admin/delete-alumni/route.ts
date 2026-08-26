import { NextResponse } from 'next/server';
import {
  getAdminClient,
  requireAdmin,
  storagePathFromPublicUrl,
  isServiceKeyProblem,
  SERVICE_KEY_MESSAGE,
} from '../../../../lib/supabaseAdmin';

// Permanently remove an alumni record.
//
// Until now "Reject" only flipped approval_status, so test rows, duplicates and
// withdrawn profiles accumulated forever: the row stayed, the photo stayed
// publicly fetchable, the auth account stayed, and the username stayed locked
// so the person could never re-register with it.
//
// Deleting properly needs the service role (removing an auth user is not
// something the anon key may do), which is why this lives in an API route
// behind an explicit admin check rather than in the browser.

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Server is not configured for admin actions yet.' }, { status: 503 });
  }

  let id: string | undefined;
  try {
    ({ id } = (await request.json()) as { id?: string });
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: 'Missing alumni id.' }, { status: 400 });

  // Read the row first: we need the photo path and auth user id before the row
  // disappears, and it confirms the record actually exists.
  const { data: person, error: readErr } = await admin
    .from('alumni')
    .select('id, full_name, photo_url, user_id')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    // Distinguished from a genuine read failure: a bad service key answers here
    // first, and "Could not read the profile: Invalid API key" tells an admin
    // nothing they can act on.
    if (isServiceKeyProblem(readErr)) {
      return NextResponse.json({ error: SERVICE_KEY_MESSAGE }, { status: 503 });
    }
    return NextResponse.json({ error: `Could not read the profile: ${readErr.message}` }, { status: 500 });
  }
  if (!person) {
    return NextResponse.json({ error: 'That profile no longer exists.' }, { status: 404 });
  }

  const warnings: string[] = [];

  // 1. Photo. Best-effort: a missing file must not abort the delete.
  const photoPath = storagePathFromPublicUrl(person.photo_url);
  if (photoPath) {
    const { error } = await admin.storage.from('photos').remove([photoPath]);
    if (error) warnings.push(`photo not removed (${error.message})`);
  }

  // 2. The profile row. higher_studies / work_experience rows disappear with it
  //    via ON DELETE CASCADE on their alumni_id foreign key.
  const { error: delErr } = await admin.from('alumni').delete().eq('id', id);
  if (delErr) {
    if (isServiceKeyProblem(delErr)) {
      return NextResponse.json({ error: SERVICE_KEY_MESSAGE }, { status: 503 });
    }
    return NextResponse.json({ error: `Could not delete the profile: ${delErr.message}` }, { status: 500 });
  }

  // 3. The login account, so the username is free again.
  if (person.user_id) {
    const { error } = await admin.auth.admin.deleteUser(person.user_id);
    if (error) warnings.push(`login account not removed (${error.message})`);
  }

  return NextResponse.json({ deleted: true, name: person.full_name, warnings });
}
