import { NextResponse } from 'next/server';
import { resolveMx } from 'node:dns/promises';
import { damerauWithin } from '../../../../lib/instituteKey';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { allowHit, clientIp, throttleKey } from '../../../../lib/throttle';

/**
 * Does this email address have any chance of being real?
 *
 * Registration accepted anything with an @ in it, which is how a typo becomes a
 * dead account: the welcome mail bounces, the reset link goes nowhere, and the
 * person is left with only their phone number as a way in. This asks DNS
 * whether the domain accepts mail at all — no message is sent, nothing is
 * stored, and the address never leaves this request.
 *
 * It is deliberately advisory. A DNS hiccup, a corporate domain that hides its
 * records, a timeout: all answer `ok`, because a validator that locks people
 * out of registering is worse than one that lets a typo through.
 */

export const runtime = 'nodejs';

/** The domains people here actually use, for "did you mean …?". */
const COMMON_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in',
  'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'protonmail.com',
  'rediffmail.com', 'dpmschools.com',
];

const MX_TIMEOUT_MS = 2500;

function suggestDomain(domain: string): string | null {
  if (COMMON_DOMAINS.includes(domain)) return null;
  for (const known of COMMON_DOMAINS) {
    // One or two slips on a short domain, up to three on a long one: "gmial.com",
    // "gmai.com", "yahooo.co.in".
    const budget = known.length >= 12 ? 3 : 2;
    if (damerauWithin(domain, known, budget)) return known;
  }
  return null;
}

export async function POST(request: Request) {
  let email = '';
  try {
    ({ email = '' } = (await request.json()) as { email?: string });
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf('@');
  if (at < 1 || at === clean.length - 1 || clean.length > 254) {
    return NextResponse.json({ ok: false, reason: 'shape' });
  }
  const domain = clean.slice(at + 1);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return NextResponse.json({ ok: false, reason: 'shape', suggestion: suggestDomain(domain) });
  }

  // A cheap endpoint, but it does make outbound DNS queries, so: 60 an hour per
  // visitor. Over the limit is answered `ok` rather than blocked.
  const admin = getAdminClient();
  if (admin) {
    const within = await allowHit(admin, throttleKey('email-check', clientIp(request)), 60, 3600);
    if (!within) return NextResponse.json({ ok: true, reason: 'throttled' });
  }

  const suggestion = suggestDomain(domain);
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), MX_TIMEOUT_MS)),
    ]);
    const deliverable = Array.isArray(records) && records.length > 0;
    return NextResponse.json({ ok: deliverable, reason: deliverable ? 'mx' : 'no-mx', suggestion });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // ENOTFOUND / NXDOMAIN mean the domain itself does not exist: that is a
    // real answer, not a failure. Anything else (timeout, SERVFAIL) is ours.
    if (code === 'ENOTFOUND' || code === 'NXDOMAIN') {
      return NextResponse.json({ ok: false, reason: 'no-domain', suggestion });
    }
    return NextResponse.json({ ok: true, reason: 'unknown', suggestion });
  }
}
