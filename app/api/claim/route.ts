import { randomBytes, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getAdminClient } from '../../../lib/supabaseAdmin';
import { CLAIM_DAYS, claimUrl, hashClaimToken, newClaimToken } from '../../../lib/claim';
import { ALUMNI_LOGIN_DOMAIN } from '../../../lib/issueLogin';
import { claimInviteEmail, sendMail, siteUrl } from '../../../lib/mailer';
import { allowHit, clientIp, throttleKey } from '../../../lib/throttle';

/**
 * Opening a claim link.
 *
 * The link is the school's invitation to a profile it started. It works once,
 * for 14 days. Opening it gives the person a login if they have none, then
 * mints a set-your-password link at that moment and sends them to it - so the
 * short lifetime of Supabase's own links never strands anyone who opened the
 * email a week late.
 *
 * `renew: true` on an expired link sends a fresh one to the email the school
 * has on file, and says only that it did - never whose profile it was, or
 * where the mail went.
 *
 * Throttled per IP: tokens are 192 random bits, so this is about load, not
 * guessing.
 */

export const runtime = 'nodejs';

type State = 'ready' | 'used' | 'expired' | 'invalid' | 'renewed' | 'unavailable';

export async function POST(request: Request) {
  let token = '';
  let renew = false;
  try {
    const body = (await request.json()) as { token?: string; renew?: boolean };
    token = String(body.token ?? '').trim();
    renew = body.renew === true;
  } catch {
    return NextResponse.json({ state: 'invalid' satisfies State }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return NextResponse.json({ state: 'invalid' satisfies State });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ state: 'unavailable' satisfies State }, { status: 503 });
  if (!(await allowHit(admin, throttleKey('claim-ip', clientIp(request)), 30, 3600))) {
    return NextResponse.json({ state: 'unavailable' satisfies State, message: 'Too many tries — wait an hour.' }, { status: 429 });
  }

  const { data: claim } = await admin.from('claim_tokens')
    .select('id, alumni_id, expires_at, used_at').eq('token_hash', hashClaimToken(token)).maybeSingle();
  if (!claim) return NextResponse.json({ state: 'invalid' satisfies State });
  if (claim.used_at) return NextResponse.json({ state: 'used' satisfies State });

  const { data: person } = await admin.from('alumni')
    .select('id, full_name, user_id, personal_email, approval_status').eq('id', claim.alumni_id).maybeSingle();
  if (!person || person.approval_status === 'rejected') return NextResponse.json({ state: 'invalid' satisfies State });

  if (new Date(claim.expires_at).getTime() < Date.now()) {
    if (!renew) return NextResponse.json({ state: 'expired' satisfies State, canRenew: !!person.personal_email });
    if (!person.personal_email) return NextResponse.json({ state: 'expired' satisfies State, canRenew: false });
    const fresh = newClaimToken();
    const { error: insErr } = await admin.from('claim_tokens').insert({
      alumni_id: person.id, token_hash: fresh.hash, channel: 'email', created_by_email: 'renewed from an expired link',
    });
    if (insErr) return NextResponse.json({ state: 'unavailable' satisfies State }, { status: 500 });
    // The old link is spent by asking: a second tap must not send a second mail.
    await admin.from('claim_tokens').update({ used_at: new Date().toISOString() }).eq('id', claim.id);
    const mail = claimInviteEmail(person.full_name, claimUrl(fresh.token), CLAIM_DAYS);
    await sendMail({ to: person.personal_email, ...mail });
    return NextResponse.json({ state: 'renewed' satisfies State });
  }

  // A login, if the school's profile has none yet. The address is an opaque
  // handle; they sign in with the email or phone on the profile.
  let userId = person.user_id as string | null;
  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: `${randomUUID()}@${ALUMNI_LOGIN_DOMAIN}`,
      password: randomBytes(24).toString('base64url'),
      email_confirm: true,
    });
    if (createErr || !created?.user) return NextResponse.json({ state: 'unavailable' satisfies State }, { status: 500 });
    const { error: linkErr } = await admin.from('alumni').update({ user_id: created.user.id }).eq('id', person.id);
    if (linkErr) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      return NextResponse.json({ state: 'unavailable' satisfies State }, { status: 500 });
    }
    userId = created.user.id;
  }

  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const signInAddress = authUser?.user?.email;
  if (!signInAddress) return NextResponse.json({ state: 'unavailable' satisfies State }, { status: 500 });

  const { data: link, error: genErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: signInAddress,
    options: { redirectTo: `${siteUrl()}/reset-password` },
  });
  if (genErr || !link?.properties?.action_link) {
    return NextResponse.json({ state: 'unavailable' satisfies State }, { status: 500 });
  }

  // Spent only now that there is somewhere to send them.
  await admin.from('claim_tokens').update({ used_at: new Date().toISOString() }).eq('id', claim.id);
  return NextResponse.json({ state: 'ready' satisfies State, redirect: link.properties.action_link });
}
