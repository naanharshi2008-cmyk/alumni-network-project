import 'server-only';
import { siteOrigin } from './site';

/**
 * Every email the site sends, in one place.
 *
 * Sends through Resend. Mail comes from the school's own address,
 * alumni@dpmschools.com, which only works once dpmschools.com is verified in
 * Resend - until then Resend refuses every recipient except the account owner.
 * Nothing here may ever throw into a caller: a mail failure must not break a
 * registration, an approval or a password reset request. Failures are returned
 * as values and logged, and /api/admin/mail-health makes them visible.
 */

const RESEND_API = 'https://api.resend.com';
const DEFAULT_FROM = 'Veveaham Alumni <alumni@dpmschools.com>';

export type MailResult =
  | { sent: true }
  | { sent: false; reason: 'not-configured' | 'provider-error' | 'network-error' | 'bad-recipient'; status?: number };

export function siteUrl(): string {
  return siteOrigin();
}

function fromHeader(): string {
  return process.env.ADMIN_EMAIL_FROM || DEFAULT_FROM;
}

/** The bare address inside "Name <address>". */
function addressOf(header: string): string {
  const m = header.match(/<([^>]+)>/);
  return (m ? m[1] : header).trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendMail(message: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'not-configured' };

  const to = (Array.isArray(message.to) ? message.to : [message.to]).map((t) => t.trim()).filter(Boolean);
  if (to.length === 0 || !to.every((t) => EMAIL_RE.test(t))) return { sent: false, reason: 'bad-recipient' };

  const from = fromHeader();
  try {
    const res = await fetch(`${RESEND_API}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        // Replies land in the school's real Workspace inbox.
        reply_to: addressOf(from),
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!res.ok) {
      // The body names recipients and addresses, so it goes to the server log
      // only, never back to a caller.
      console.error('mailer: Resend rejected a message', res.status, await res.text().catch(() => ''));
      return { sent: false, reason: 'provider-error', status: res.status };
    }
    return { sent: true };
  } catch (err) {
    console.error('mailer: could not reach Resend', err);
    return { sent: false, reason: 'network-error' };
  }
}

/* ── Layout ─────────────────────────────────────────────────────────────── */

/**
 * A table-based layout, because that is what renders consistently across
 * Gmail, Outlook and phone mail apps. Light theme on purpose: most mail
 * clients force it anyway, and the crest was drawn for a light background.
 */
function layout(opts: {
  preheader: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  footnote?: string;
}): string {
  const crest = `${siteUrl()}/brand/crest-96.png`;
  const body = opts.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#2b2733">${p}</p>`)
    .join('');
  const button = opts.cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 8px"><tr><td style="border-radius:999px;background:#1c1726">
         <a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${escapeHtml(opts.cta.label)}</a>
       </td></tr></table>
       <p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#7a7486">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all;color:#5b5566">${escapeHtml(opts.cta.url)}</span></p>`
    : '';
  const footnote = opts.footnote
    ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#7a7486">${opts.footnote}</p>`
    : '';

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f1ea">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.preheader)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
        <tr><td style="background:#fbf6ec;padding:22px 28px;border-bottom:1px solid #eee4d3">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td><img src="${crest}" width="44" height="44" alt="Veveaham" style="display:block"></td>
            <td style="padding-left:12px;font-size:16px;font-weight:700;color:#1c1726">Veveaham Alumni</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#1c1726">${escapeHtml(opts.heading)}</h1>
          ${body}${button}${footnote}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#faf8f4;border-top:1px solid #efe9df;font-size:12px;color:#8a8494">
          Veveaham Group of Schools, Dharapuram · <a href="${siteUrl()}" style="color:#8a8494">${siteUrl().replace(/^https?:\/\//, '')}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function firstName(fullName: string | null | undefined): string {
  return escapeHtml((fullName ?? '').trim().split(/\s+/)[0] || 'there');
}

/* ── Templates ──────────────────────────────────────────────────────────── */

export function passwordResetEmail(fullName: string | null, link: string) {
  const name = firstName(fullName);
  return {
    subject: 'Reset your Veveaham Alumni password',
    html: layout({
      preheader: 'Use this link within an hour to choose a new password.',
      heading: 'Choose a new password',
      paragraphs: [
        `Hi ${name},`,
        'Someone asked to reset the password for your Veveaham Alumni account. If that was you, use the button below. The link works once and expires in an hour.',
      ],
      cta: { label: 'Set a new password', url: link },
      footnote: "Didn't ask for this? You can ignore this email — your password stays the same.",
    }),
    text: `Hi ${(fullName ?? '').trim().split(/\s+/)[0] || 'there'},\n\nSomeone asked to reset the password for your Veveaham Alumni account. If that was you, open this link (it works once and expires in an hour):\n\n${link}\n\nDidn't ask for this? Ignore this email and your password stays the same.`,
  };
}

export function welcomeEmail(fullName: string | null) {
  const name = firstName(fullName);
  const profile = `${siteUrl()}/profile`;
  return {
    subject: 'Welcome to the Veveaham Alumni network',
    html: layout({
      preheader: "We've received your profile. The school will review it shortly.",
      heading: `Welcome, ${name}`,
      paragraphs: [
        'Thank you for adding your journey. Students in classes 8 to 12 — and their parents — use these profiles to see where seniors went after school, and how they got there.',
        "The school reviews every profile before it goes public, so yours will appear in the directory once it's approved. You'll get another email when it does.",
        'Your email and phone number are never shown publicly.',
      ],
      cta: { label: 'View your profile', url: profile },
    }),
    text: `Welcome, ${(fullName ?? '').trim().split(/\s+/)[0] || 'there'}.\n\nThank you for adding your journey. The school reviews every profile before it goes public; you'll get another email once yours is approved.\n\nYour email and phone number are never shown publicly.\n\nView your profile: ${profile}`,
  };
}

/**
 * The school started their page; this invites them to it.
 *
 * One claim link, the same in the email and the WhatsApp text, and never a
 * password: opening it mints a fresh set-your-password link at that moment
 * (app/api/claim), so Supabase's short link lifetime never strands anyone.
 */
export function claimInviteEmail(fullName: string | null, link: string, days: number) {
  const name = firstName(fullName);
  return {
    subject: 'Your page on the Veveaham Alumni network is waiting for you',
    html: layout({
      preheader: 'The school office has started it. Check what we have and add the rest.',
      heading: `${name}, your page is ready to finish`,
      paragraphs: [
        `Hi ${name},`,
        'The Veveaham school office has started your page on the alumni network — where you went after Class 12, so students in classes 8 to 12 can see the paths ahead of them.',
        'Check what we have, add the rest, and choose a password. Nothing is shown publicly until you have agreed and the school has approved it, and your phone number and email are never shown.',
      ],
      cta: { label: 'Open my page', url: link },
      footnote: `The link works once and expires in ${days} days. Not you, or not interested? Just ignore this email.`,
    }),
    text: `Hi ${(fullName ?? '').trim().split(/\s+/)[0] || 'there'},\n\nThe Veveaham school office has started your page on the alumni network, so juniors can see where seniors went after Class 12. Check what we have, add the rest and choose a password here (the link works once, for ${days} days):\n\n${link}\n\nNothing is public until you agree and the school approves it.`,
  };
}

/** The same invitation, as a WhatsApp message the office sends from its own phone. */
export function claimInviteWhatsApp(fullName: string | null, link: string, days: number): string {
  const name = (fullName ?? '').trim().split(/\s+/)[0] || 'there';
  return `Hi ${name}! The Veveaham school office has started your page on the Veveaham Alumni network — where you went after Class 12, so juniors can see the paths ahead. Check it, add the rest and set a password here (works once, for ${days} days): ${link}\n\nNothing is public until you agree and the school approves it.`;
}

export function verifyEmailMessage(fullName: string | null, link: string) {
  const name = firstName(fullName);
  return {
    subject: 'Confirm your email for Veveaham Alumni',
    html: layout({
      preheader: 'One tap so the school knows this address reaches you.',
      heading: 'Is this the right address?',
      paragraphs: [
        `Hi ${name},`,
        'You used this address to register with the Veveaham alumni network. Confirming it means the school can reach you, and that a password reset will actually arrive if you ever need one.',
        'The link works once and expires in an hour. Nothing bad happens if you ignore it — your profile is reviewed either way.',
      ],
      cta: { label: 'Confirm this address', url: link },
      footnote: "Didn't register with us? Ignore this email and nothing will happen.",
    }),
    text: `Hi ${(fullName ?? '').trim().split(/\s+/)[0] || 'there'},\n\nYou used this address to register with the Veveaham alumni network. Confirm it so the school can reach you, and so a password reset would actually arrive:\n\n${link}\n\nThe link works once and expires in an hour. Ignoring it is fine - your profile is reviewed either way.`,
  };
}

export function approvedEmail(fullName: string | null, profileUrl: string) {
  const name = firstName(fullName);
  return {
    subject: 'Your Veveaham Alumni profile is live',
    html: layout({
      preheader: 'Your profile is now in the public directory.',
      heading: `You're in the directory, ${name}`,
      paragraphs: [
        'The school has approved your profile, and juniors can now see your path.',
        'You can keep it up to date any time — new courses, new roles, advice you wish you had heard.',
      ],
      cta: { label: 'See your public profile', url: profileUrl },
    }),
    text: `You're in the directory, ${(fullName ?? '').trim().split(/\s+/)[0] || 'there'}.\n\nThe school has approved your profile. See it here: ${profileUrl}\n\nYou can keep it up to date any time from your profile page.`,
  };
}

export function adminNewRegistrationEmail(r: {
  fullName: string; classOf: string; school: string; college: string; status: string;
}) {
  const rows = [
    ['Name', r.fullName], ['Class of', r.classOf], ['School', r.school], ['College', r.college], ['Status', r.status],
  ]
    .map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#7a7486">${k}</td><td style="color:#1c1726"><strong>${escapeHtml(v || '—')}</strong></td></tr>`)
    .join('');
  return {
    subject: `New alumni registration: ${r.fullName || 'pending review'}`,
    html: layout({
      preheader: `${r.fullName || 'Someone'} is waiting for review.`,
      heading: 'New registration waiting for review',
      paragraphs: [`<table role="presentation" style="border-collapse:collapse;font-size:14px">${rows}</table>`],
      cta: { label: 'Open the admin dashboard', url: `${siteUrl()}/admin` },
    }),
    text: `New registration waiting for review.\n\nName: ${r.fullName}\nClass of: ${r.classOf}\nSchool: ${r.school}\nCollege: ${r.college}\nStatus: ${r.status}\n\n${siteUrl()}/admin`,
  };
}

/* ── Health ─────────────────────────────────────────────────────────────── */

export type MailHealth = {
  apiKeySet: boolean;
  from: string;
  domain: string;
  domainStatus: 'verified' | 'pending' | 'not-added' | 'unknown';
  adminAlertsTo: boolean;
  hint: string;
};

/** What an admin needs to know about email, without exposing any secret. */
export async function mailHealth(): Promise<MailHealth> {
  const from = fromHeader();
  const domain = addressOf(from).split('@')[1] ?? '';
  const apiKey = process.env.RESEND_API_KEY;
  const base = { apiKeySet: !!apiKey, from, domain, adminAlertsTo: !!process.env.ADMIN_EMAIL };

  if (!apiKey) {
    return { ...base, domainStatus: 'unknown', hint: 'RESEND_API_KEY is not set in Vercel, so no email can be sent.' };
  }
  try {
    const res = await fetch(`${RESEND_API}/domains`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      return {
        ...base, domainStatus: 'unknown',
        hint: res.status === 401
          ? 'RESEND_API_KEY is not valid — regenerate it in Resend and update it in Vercel.'
          : `Resend answered ${res.status} when asked for domain status.`,
      };
    }
    const body = (await res.json()) as { data?: { name: string; status: string }[] };
    const match = (body.data ?? []).find((d) => d.name.toLowerCase() === domain.toLowerCase());
    if (!match) {
      return { ...base, domainStatus: 'not-added', hint: `${domain} is not added in Resend yet, so mail from ${addressOf(from)} is refused.` };
    }
    if (match.status === 'verified') {
      return { ...base, domainStatus: 'verified', hint: base.adminAlertsTo ? 'Email is working.' : 'Email is working, but ADMIN_EMAIL is not set, so new-registration alerts have nowhere to go.' };
    }
    return { ...base, domainStatus: 'pending', hint: `${domain} is added in Resend but its DNS records are not verified yet (status: ${match.status}).` };
  } catch {
    return { ...base, domainStatus: 'unknown', hint: 'Could not reach Resend to check email status.' };
  }
}
