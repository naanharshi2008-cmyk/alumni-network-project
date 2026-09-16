import { NextResponse } from 'next/server';
import { getAdminClient, requireUser } from '../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';

// Clears the "must change password" flag an admin reset sets. app_metadata can
// only be written with the service role, so the reset page calls this after the
// person has chosen their own password.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  if (!auth.user.app_metadata?.must_change_password) return NextResponse.json({ ok: true });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: 'Server is not configured yet.' }, { status: 503 });

  const { error } = await admin.auth.admin.updateUserById(auth.user.id, {
    app_metadata: { ...auth.user.app_metadata, must_change_password: false },
  });
  if (error) return NextResponse.json({ error: 'Could not update your account. Please try again.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
