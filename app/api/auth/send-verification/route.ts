import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { getAdminClient, requireUser } from '../../../../lib/supabaseAdmin';
import { sendMail, siteUrl, verifyEmailMessage } from '../../../../lib/mailer';
import { allowHit, throttleKey } from '../../../../lib/throttle';

/**
 * Send "is this the right address?" to the signed-in alumnus's own email.
 *
 * Registration accepts an address nobody has ever proved. A typo means the
 * welcome mail bounces and, worse, a future password reset goes to a stranger's
 * inbox or nowhere at all. This proves it once, and the profile and admin list
 * then say so.
 *
 * It is not a gate. Approval by the school remains the only gate, and a
 * registration completes whether or not this mail can be sent.
 *
 * The address is taken from the caller's own row, never from the request, so
 * this cannot be pointed at anybody else's inbox.
 */

export const runtime = 'nodejs';

const TOKEN_TTL_MINUTES = 60;

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ sent: false, reason: 'not-configured' });

  const { data: person, error } = await admin
    .from('alumni')
    .select('id, full_name, personal_email, email_key, email_verified_at')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (error || !person) return NextResponse.json({ error: 'We could not find your profile.' }, { status: 404 });
  if (person.email_verified_at) return NextResponse.json({ sent: false, reason: 'already-verified' });
  if (!person.personal_email) return NextResponse.json({ error: 'There is no email on your profile yet.' }, { status: 400 });

  // Three an hour per profile: enough to cope with a mistyped address, not
  // enough to use the school's mail server to bother anyone.
  const within = await allowHit(admin, throttleKey('verify-send', person.id), 3, 3600);
  if (!within) {
    return NextResponse.json({ sent: false, reason: 'throttled', message: 'We have just sent one — please check your inbox and spam folder.' });
  }

  // Only the hash is stored: this table can be read by nobody, but even so it
  // must not be a list of working links.
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000).toISOString();

  const { error: insErr } = await admin.from('email_verifications').insert({
    token_hash: tokenHash,
    alumni_id: person.id,
    email_key: person.email_key,
    expires_at: expires,
  });
  if (insErr) {
    console.error('send-verification: could not store token', insErr);
    return NextResponse.json({ sent: false, reason: 'storage-error' });
  }

  const link = `${siteUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const message = verifyEmailMessage(person.full_name, link);
  const result = await sendMail({ to: person.personal_email, ...message });

  // A mail failure is reported, never thrown: the profile is unaffected either
  // way, and the admin dashboard already warns when sending is not configured.
  return NextResponse.json({ sent: result.sent, reason: result.sent ? undefined : result.reason });
}
