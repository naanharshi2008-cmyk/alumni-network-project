import { NextResponse } from 'next/server';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { emailKey, looksLikePhone, phoneLoginCandidates } from '../../../../lib/contactKeys';
import { passwordResetEmail, sendMail, siteUrl } from '../../../../lib/mailer';
import { allowHit, clientIp, throttleKey } from '../../../../lib/throttle';

export const runtime = 'nodejs';

// Password reset by email, for someone who knows their email or phone number.
//
// The response is identical whether or not an account exists, so this route
// cannot be used to discover who is registered. The link is minted with the
// service role (generateLink) for the account's internal sign-in address and
// mailed to the person's REAL email, which the internal address could never
// receive. Throttled per contact and per IP so it cannot be used to flood
// anyone's inbox.

const SAME_ANSWER = {
  ok: true,
  message: "If that email or phone number belongs to an account, we've sent a reset link to its email address.",
};

export async function POST(request: Request) {
  let identifier = '';
  try {
    identifier = String(((await request.json()) as { identifier?: string }).identifier ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }
  if (!identifier || identifier.length > 120) {
    return NextResponse.json({ error: 'Enter the email or phone number you registered with.' }, { status: 400 });
  }

  const admin = getAdminClient();
  if (!admin) return NextResponse.json(SAME_ANSWER);

  const ip = clientIp(request);
  const [contactOk, ipOk] = await Promise.all([
    allowHit(admin, throttleKey('forgot-contact', identifier.toLowerCase()), 3, 3600),
    allowHit(admin, throttleKey('forgot-ip', ip), 10, 3600),
  ]);
  if (!contactOk || !ipOk) {
    return NextResponse.json(
      { error: 'Too many reset requests. Please wait an hour, or ask the school office to reset it for you.' },
      { status: 429 },
    );
  }

  let query = admin.from('alumni').select('user_id, full_name, personal_email').not('user_id', 'is', null).limit(1);
  if (identifier.includes('@')) {
    query = query.eq('email_key', emailKey(identifier));
  } else if (looksLikePhone(identifier)) {
    const candidates = phoneLoginCandidates(identifier);
    if (candidates.length === 0) return NextResponse.json(SAME_ANSWER);
    query = query.in('phone_key', candidates);
  } else {
    return NextResponse.json(SAME_ANSWER);
  }

  const { data: person } = await query.maybeSingle();
  if (!person?.user_id || !person.personal_email) return NextResponse.json(SAME_ANSWER);

  const { data: authUser } = await admin.auth.admin.getUserById(person.user_id);
  const signInAddress = authUser?.user?.email;
  if (!signInAddress) return NextResponse.json(SAME_ANSWER);

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: signInAddress,
    options: { redirectTo: `${siteUrl()}/reset-password` },
  });
  if (linkErr || !link?.properties?.action_link) {
    console.error('forgot: could not generate a recovery link', linkErr?.message);
    return NextResponse.json(SAME_ANSWER);
  }

  const mail = passwordResetEmail(person.full_name, link.properties.action_link);
  const result = await sendMail({ to: person.personal_email, ...mail });
  if (!result.sent) console.error('forgot: reset email not sent', result);

  return NextResponse.json(SAME_ANSWER);
}
