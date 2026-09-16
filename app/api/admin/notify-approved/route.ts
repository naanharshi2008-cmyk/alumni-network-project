import { NextResponse } from 'next/server';
import { getAdminClient, requireAdmin } from '../../../../lib/supabaseAdmin';
import { approvedEmail, sendMail, siteUrl } from '../../../../lib/mailer';
import { allowHit, throttleKey } from '../../../../lib/throttle';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Your profile is live" emails, after an admin approves. Only rows that really
// are approved get one, and each person at most once a day.
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: 'Server is not configured yet.' }, { status: 503 });

  let ids: string[] = [];
  try {
    ids = ((await request.json()) as { ids?: string[] }).ids ?? [];
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }
  ids = ids.filter((id) => UUID_RE.test(id)).slice(0, 100);
  if (ids.length === 0) return NextResponse.json({ sent: 0 });

  const { data: rows } = await admin
    .from('alumni')
    .select('id, full_name, personal_email, public_slug, approval_status')
    .in('id', ids)
    .eq('approval_status', 'approved');

  let sent = 0;
  for (const row of rows ?? []) {
    if (!row.personal_email) continue;
    if (!(await allowHit(admin, throttleKey('approved', row.id), 1, 24 * 3600))) continue;
    const url = `${siteUrl()}/directory?p=${encodeURIComponent(row.public_slug ?? '')}`;
    const result = await sendMail({ to: row.personal_email, ...approvedEmail(row.full_name, url) });
    if (result.sent) sent += 1;
  }
  return NextResponse.json({ sent });
}
