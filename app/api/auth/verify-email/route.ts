import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { allowHit, clientIp, throttleKey } from '../../../../lib/throttle';

/**
 * Spend a verification token.
 *
 * No session is required: the token in the link is the proof, which is the
 * point — people open mail on a phone that is not signed in. It works once,
 * expires in an hour, and is checked against the address that was on the
 * profile when it was sent, so a token cannot verify an address the person
 * changed to afterwards.
 */

export const runtime = 'nodejs';

const DONE = { ok: true, message: 'Thank you — your email address is confirmed.' };

export async function POST(request: Request) {
  let token = '';
  try {
    token = String(((await request.json()) as { token?: string }).token ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }
  if (!token || token.length > 200) {
    return NextResponse.json({ error: 'That link is not valid.' }, { status: 400 });
  }

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });

  // Guessing a 256-bit token is not realistic, but rate-limit anyway so this
  // cannot be hammered.
  const within = await allowHit(admin, throttleKey('verify-use', clientIp(request)), 30, 3600);
  if (!within) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data: row } = await admin
    .from('email_verifications')
    .select('token_hash, alumni_id, email_key, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: 'That link is not valid. Ask for a new one from your profile.' }, { status: 400 });
  // Spending it twice is not an error worth alarming anyone about.
  if (row.used_at) return NextResponse.json(DONE);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'That link has expired. Ask for a new one from your profile.' }, { status: 400 });
  }

  const { data: person } = await admin
    .from('alumni')
    .select('id, email_key')
    .eq('id', row.alumni_id)
    .maybeSingle();

  if (!person) return NextResponse.json({ error: 'That profile no longer exists.' }, { status: 404 });
  if (person.email_key !== row.email_key) {
    return NextResponse.json(
      { error: 'The email on this profile has changed since that link was sent. Ask for a new one from your profile.' },
      { status: 400 },
    );
  }

  const { error: updErr } = await admin
    .from('alumni')
    .update({ email_verified_at: new Date().toISOString() })
    .eq('id', person.id);
  if (updErr) {
    console.error('verify-email: could not mark verified', updErr);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  await admin.from('email_verifications').update({ used_at: new Date().toISOString() }).eq('token_hash', tokenHash);
  return NextResponse.json(DONE);
}
