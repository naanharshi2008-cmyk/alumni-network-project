import { NextResponse } from 'next/server';
import { getAdminClient, requireAdmin, safeErrorMessage } from '../../../../lib/supabaseAdmin';
import { CLAIM_DAYS, claimUrl, newClaimToken, whatsappLink } from '../../../../lib/claim';
import { claimInviteEmail, claimInviteWhatsApp, sendMail } from '../../../../lib/mailer';

/**
 * Invite someone to a profile the school started - by email, by WhatsApp, or
 * as a link to copy. Every channel carries the same kind of claim link and
 * never a password.
 *
 * Email goes from alumni@dpmschools.com through the site's mailer. WhatsApp is
 * prepared, not sent: the office sends it from its own phone, which is the
 * number parents already know.
 *
 * Service role: claim_tokens is the school's alone, and the office note's
 * "login sent" stamp is written here too.
 */

export const runtime = 'nodejs';

type Body = { alumni_id?: string; channel?: 'email' | 'whatsapp' | 'link' };

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: 'Server is not configured yet.' }, { status: 503 });

  let body: Body;
  try { body = (await request.json()) as Body; } catch { return NextResponse.json({ error: 'Malformed request.' }, { status: 400 }); }
  const channel = body.channel ?? 'link';
  if (!['email', 'whatsapp', 'link'].includes(channel)) return NextResponse.json({ error: 'Unknown channel.' }, { status: 400 });
  if (!body.alumni_id) return NextResponse.json({ error: 'Which profile?' }, { status: 400 });

  const { data: person, error: findErr } = await admin.from('alumni')
    .select('id, full_name, personal_email, phone_country_code, phone_number, approval_status')
    .eq('id', body.alumni_id).maybeSingle();
  if (findErr) return NextResponse.json({ error: safeErrorMessage(findErr) }, { status: 500 });
  if (!person) return NextResponse.json({ error: 'That profile no longer exists.' }, { status: 404 });
  if (person.approval_status === 'rejected') {
    return NextResponse.json({ error: 'This profile is hidden. Restore it before inviting them.' }, { status: 409 });
  }
  if (channel === 'email' && !person.personal_email) {
    return NextResponse.json({ error: 'There is no email on this profile — use WhatsApp or copy the link.' }, { status: 400 });
  }

  const { token, hash } = newClaimToken();
  const { error: tokErr } = await admin.from('claim_tokens').insert({
    alumni_id: person.id, token_hash: hash, channel, created_by_email: auth.email,
  });
  if (tokErr) return NextResponse.json({ error: `Could not make the link: ${safeErrorMessage(tokErr)}` }, { status: 500 });

  const url = claimUrl(token);
  const text = claimInviteWhatsApp(person.full_name, url, CLAIM_DAYS);
  let emailed: boolean | null = null;
  let emailProblem: string | null = null;
  if (channel === 'email') {
    const mail = claimInviteEmail(person.full_name, url, CLAIM_DAYS);
    const result = await sendMail({ to: person.personal_email!, ...mail });
    emailed = result.sent;
    if (!result.sent) emailProblem = 'reason' in result ? String(result.reason) : 'not sent';
  }

  // Stamped whether or not the mail went, since the link exists either way.
  await admin.from('alumni_office_notes')
    .upsert({ alumni_id: person.id, login_sent_at: new Date().toISOString() }, { onConflict: 'alumni_id' });
  await admin.from('review_events').insert({
    actor_email: auth.email, subject_kind: 'profile', subject_id: person.id, alumni_id: person.id,
    action: 'invite', summary: `Invited ${person.full_name} (${channel})`, undoable: false,
  });

  return NextResponse.json({
    url,
    text,
    whatsapp: whatsappLink(text, person.phone_country_code, person.phone_number),
    emailed,
    emailProblem,
    expiresInDays: CLAIM_DAYS,
  });
}
