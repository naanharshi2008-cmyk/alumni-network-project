import { NextResponse } from 'next/server';

// Tells an administrator that a new alumnus is waiting for review.
//
// The registration form has always POSTed here, but the route did not exist,
// so every submission quietly 404'd and nobody was ever told. Admins had to
// remember to open the dashboard and look.
//
// Design notes:
//   - This must NEVER break a registration. Every failure path returns 200
//     with { sent: false }, because the profile is already safely saved by the
//     time this is called; a bounced email is not the student's problem.
//   - Email goes out through Resend. Until RESEND_API_KEY and ADMIN_EMAIL are
//     set in Vercel, the route no-ops instead of erroring, so the site works
//     before the keys are configured.

export const runtime = 'nodejs';

type Payload = {
  fullName?: string;
  classOf?: string | number;
  school?: string;
  currentStatus?: string;
  college?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function POST(request: Request) {
  let body: Payload = {};
  try {
    body = (await request.json()) as Payload;
  } catch {
    // An unreadable body still shouldn't surface as an error to the client.
    return NextResponse.json({ sent: false, reason: 'bad-request' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_EMAIL;
  // Resend requires a verified sender; onboarding@resend.dev works out of the
  // box for testing before a custom domain is verified.
  const from = process.env.ADMIN_EMAIL_FROM ?? 'Veveaham Alumni <onboarding@resend.dev>';

  if (!apiKey || !to) {
    // Not configured yet - this is an expected state, not a failure.
    return NextResponse.json({ sent: false, reason: 'not-configured' });
  }

  const name = escapeHtml(String(body.fullName ?? 'Someone'));
  const classOf = escapeHtml(String(body.classOf ?? '—'));
  const school = escapeHtml(String(body.school ?? '—'));
  const status = escapeHtml(String(body.currentStatus ?? '—'));
  const college = escapeHtml(String(body.college ?? '—'));

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://v-alumninetwork.vercel.app';

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px">
      <h2 style="margin:0 0 4px">New alumni registration</h2>
      <p style="color:#555;margin:0 0 16px">Waiting for your review.</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#777">Name</td><td><strong>${name}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#777">Class of</td><td>${classOf}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#777">School</td><td>${school}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#777">College</td><td>${college}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#777">Status</td><td>${status}</td></tr>
      </table>
      <p style="margin:20px 0 0">
        <a href="${siteUrl}/admin" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">
          Open the admin dashboard
        </a>
      </p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: to.split(',').map((e) => e.trim()).filter(Boolean),
        subject: `New alumni registration: ${body.fullName ?? 'pending review'}`,
        html,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('notify-admin: Resend rejected the request', res.status, detail);
      return NextResponse.json({ sent: false, reason: 'provider-error' });
    }
    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error('notify-admin: could not reach the email provider', err);
    return NextResponse.json({ sent: false, reason: 'network-error' });
  }
}
