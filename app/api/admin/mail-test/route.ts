import { NextResponse } from 'next/server';
import { getAdminClient, requireAdmin } from '../../../../lib/supabaseAdmin';
import { sendMail, testEmail } from '../../../../lib/mailer';
import { allowHit, throttleKey } from '../../../../lib/throttle';

/**
 * Send a test email, from the Today page. Staff accounts sign in with an
 * internal address that receives nothing, so the office names a real inbox -
 * ADMIN_EMAIL by default. Throttled, since it can mail any address.
 */

export const runtime = 'nodejs';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  let to = '';
  try { to = String(((await request.json()) as { to?: string }).to ?? '').trim(); } catch { /* default below */ }
  to = to || process.env.ADMIN_EMAIL || '';
  if (!EMAIL_RE.test(to)) return NextResponse.json({ error: 'Give an email address to send the test to.' }, { status: 400 });
  const admin = getAdminClient();
  if (admin && !(await allowHit(admin, throttleKey('mail-test', auth.email), 10, 3600))) {
    return NextResponse.json({ error: 'That is enough tests for an hour.' }, { status: 429 });
  }
  const result = await sendMail({ to, ...testEmail() });
  return NextResponse.json(result.sent ? { sent: true, to } : { sent: false, reason: result.reason, status: result.status ?? null });
}
