import 'server-only';
import { GMAIL_SEND, googleConfigured, googleSubject, googleToken } from './googleAuth';
import { siteOrigin } from './site';

/**
 * Every email the site sends, in one place.
 *
 * Two ways out, and the site uses whichever is configured:
 *
 * 1. The school's own Google Workspace mailbox, alumni@dpmschools.com, through
 *    the Gmail API as a service account the Workspace admin has allowed
 *    (lib/googleAuth.ts). This needs NO DNS record of any kind - the mail
 *    leaves Google exactly as the office's own mail does - which is why it is
 *    preferred: the domain's DNS is held by the school's ERP provider.
 * 2. Resend, when a key is set and Workspace is not. Needs the domain verified
 *    in Resend, which needs DNS records.
 *
 * Nothing here may ever throw into a caller: a mail failure must not break a
 * registration, an approval or a password reset request. Failures are returned
 * as values and logged, and /api/admin/mail-health makes them visible.
 */

const RESEND_API = 'https://api.resend.com';
const DEFAULT_FROM = 'Veveaham Alumni <alumni@dpmschools.com>';

export type MailResult =
  | { sent: true }
  // 'rate-limited' is its own answer because it is the one failure that is
  // not a fault: the free plan sends 100 a day, and the rest go tomorrow.
  | { sent: false; reason: 'not-configured' | 'provider-error' | 'network-error' | 'bad-recipient' | 'rate-limited' | 'not-delegated'; status?: number };

/** Which way out the site is set up to use. */
export type MailTransport = 'workspace' | 'resend' | 'none';

export function mailTransport(): MailTransport {
  const forced = (process.env.MAIL_TRANSPORT ?? '').toLowerCase();
  if (forced === 'resend') return process.env.RESEND_API_KEY ? 'resend' : 'none';
  if (forced === 'workspace') return googleConfigured() ? 'workspace' : 'none';
  if (googleConfigured()) return 'workspace';
  return process.env.RESEND_API_KEY ? 'resend' : 'none';
}

/** RFC 2047, so a subject with an em dash survives every mail client. */
function encodeSubject(subject: string): string {
  return /^[\x20-\x7E]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

/** The message as MIME: a plain-text part and an HTML one, as every mailer sends. */
function mimeMessage(opts: {
  from: string; to: string[]; subject: string; html: string; text: string; headers?: Record<string, string>;
}): string {
  const boundary = `veveaham-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const extra = Object.entries(opts.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join('');
  return [
    `From: ${opts.from}`,
    `To: ${opts.to.join(', ')}`,
    `Reply-To: ${addressOf(opts.from)}`,
    `Subject: ${encodeSubject(opts.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    extra.trimEnd(),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(opts.text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(opts.html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}--`,
    '',
  ].filter((line) => line !== undefined).join('\r\n');
}

/**
 * Send as the school's own mailbox, through Gmail.
 *
 * Workspace allows about 2,000 recipients a day, which is more than a whole
 * batch of leavers; over that Google answers 429 and the caller is told to
 * come back tomorrow rather than shown a fault.
 */
async function sendViaWorkspace(message: {
  to: string[]; subject: string; html: string; text: string; from: string; headers?: Record<string, string>;
}): Promise<MailResult> {
  const token = await googleToken([GMAIL_SEND]);
  if ('error' in token) {
    console.error('mailer: Google would not issue a token —', token.error);
    return { sent: false, reason: /has not allowed/.test(token.error) ? 'not-delegated' : 'not-configured' };
  }
  const raw = Buffer.from(mimeMessage(message), 'utf8').toString('base64url');
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('mailer: Gmail rejected a message', res.status, body);
      const limited = res.status === 429 || /rateLimitExceeded|quota|limit/i.test(body);
      return { sent: false, reason: limited ? 'rate-limited' : 'provider-error', status: res.status };
    }
    return { sent: true };
  } catch (err) {
    console.error('mailer: could not reach Gmail', err);
    return { sent: false, reason: 'network-error' };
  }
}

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

/**
 * Which kind of mail this is.
 *
 * `transactional` - resets, confirmations, invitations, approvals: one person,
 * something they asked for or need. From alumni@dpmschools.com.
 *
 * `broadcast` - the same message to many (a newsletter, a reunion). Not sent
 * yet, but the shape is here so it is an addition when it comes, not a
 * rewrite: it must come from a separate sender (BROADCAST_FROM, on its own
 * verified subdomain, so complaints about bulk mail never touch the
 * reputation that password resets travel on) and must carry a one-click
 * unsubscribe, which Gmail requires of bulk senders.
 */
export type MailStream = 'transactional' | 'broadcast';

export async function sendMail(message: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  stream?: MailStream;
  /** Required for a broadcast: the one-click unsubscribe address. */
  unsubscribeUrl?: string;
}): Promise<MailResult> {
  const to = (Array.isArray(message.to) ? message.to : [message.to]).map((t) => t.trim()).filter(Boolean);
  if (to.length === 0 || !to.every((t) => EMAIL_RE.test(t))) return { sent: false, reason: 'bad-recipient' };

  const stream = message.stream ?? 'transactional';
  const transport = mailTransport();

  if (transport === 'workspace') {
    // The From must be the mailbox the site is allowed to act as, or Gmail
    // refuses it.
    const name = fromHeader().replace(/\s*<[^>]*>\s*/, '').trim() || 'Veveaham Alumni';
    return sendViaWorkspace({
      to, subject: message.subject, html: message.html, text: message.text,
      from: `${name} <${googleSubject()}>`,
      headers: stream === 'broadcast' && message.unsubscribeUrl
        ? { 'List-Unsubscribe': `<${message.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
        : undefined,
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'not-configured' };

  const broadcastFrom = process.env.BROADCAST_FROM;
  // A broadcast never falls back to the transactional sender.
  if (stream === 'broadcast' && (!broadcastFrom || !message.unsubscribeUrl)) return { sent: false, reason: 'not-configured' };
  const from = stream === 'broadcast' ? broadcastFrom! : fromHeader();
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
        tags: [{ name: 'stream', value: stream }],
        ...(stream === 'broadcast' ? {
          headers: {
            'List-Unsubscribe': `<${message.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        } : {}),
      }),
    });
    if (!res.ok) {
      // The body names recipients and addresses, so it goes to the server log
      // only, never back to a caller.
      const body = await res.text().catch(() => '');
      console.error('mailer: Resend rejected a message', res.status, body);
      const limited = res.status === 429 || /daily|rate.?limit|quota/i.test(body);
      return { sent: false, reason: limited ? 'rate-limited' : 'provider-error', status: res.status };
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

/** The Today page's "Send a test email": proves the whole path, SPF to inbox. */
export function testEmail() {
  return {
    subject: 'Test email from the Veveaham Alumni site',
    html: layout({
      preheader: 'If this arrived in your inbox, email from the site is working.',
      heading: 'Email is working',
      paragraphs: [
        'This is a test from the admin dashboard. If it reached your inbox (not spam), password resets, invitations and alerts will too.',
        'To check the domain is authenticated, open this message in Gmail, choose ⋮ → Show original, and look for SPF, DKIM and DMARC: PASS.',
      ],
    }),
    text: 'This is a test from the Veveaham Alumni admin dashboard. If it reached your inbox, email from the site is working. In Gmail, Show original should read SPF, DKIM and DMARC: PASS.',
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

export type RecordState = 'ok' | 'missing' | 'wrong' | 'unknown';

export type MailHealth = {
  /** Which way out is configured: the school's mailbox, Resend, or neither. */
  transport: MailTransport;
  /** Set when sending as the school's own mailbox. */
  workspace?: { subject: string; ok: boolean; problem: string };
  apiKeySet: boolean;
  from: string;
  domain: string;
  domainStatus: 'verified' | 'pending' | 'not-added' | 'unknown' | 'not-used';
  adminAlertsTo: boolean;
  hint: string;
  /** What the domain's DNS says, read publicly - so the Today page can name what is missing. */
  records: { spf: RecordState; googleDkim: RecordState; resendDkim: RecordState; dmarc: RecordState; detail: string[] };
};

/** TXT records for a name, over DNS-over-HTTPS (Cloudflare). Null when the lookup failed. */
async function txt(name: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: 'application/dns-json' }, cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
    return (body.Answer ?? []).filter((a) => a.type === 16).map((a) => a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
  } catch {
    return null;
  }
}

/**
 * SPF, DKIM (Google's and Resend's) and DMARC for the sending domain. Only
 * one SPF record may exist, and it must let Google send; Resend's return path
 * lives on its own subdomain and needs no change to it.
 */
async function domainRecords(domain: string): Promise<MailHealth['records']> {
  const [root, google, resend, dmarc] = await Promise.all([
    txt(domain), txt(`google._domainkey.${domain}`), txt(`resend._domainkey.${domain}`), txt(`_dmarc.${domain}`),
  ]);
  const detail: string[] = [];
  const spfs = root?.filter((r) => /^v=spf1/i.test(r)) ?? [];
  const spf: RecordState = root === null ? 'unknown'
    : spfs.length === 0 ? 'missing'
      : spfs.length > 1 || !/include:_spf\.google\.com/i.test(spfs[0]) ? 'wrong' : 'ok';
  if (spf === 'missing') detail.push(`No SPF record on ${domain} (v=spf1 include:_spf.google.com ~all).`);
  if (spf === 'wrong') detail.push(spfs.length > 1 ? `${domain} has ${spfs.length} SPF records; only one is allowed.` : 'The SPF record does not include Google.');
  const has = (rows: string[] | null, re: RegExp): RecordState => (rows === null ? 'unknown' : rows.some((r) => re.test(r)) ? 'ok' : 'missing');
  const googleDkim = has(google, /v=DKIM1/i);
  const resendDkim = has(resend, /p=/i);
  const dm = has(dmarc, /^v=DMARC1/i);
  if (googleDkim === 'missing') detail.push('Google Workspace DKIM (google._domainkey) is not published — generate it in the Admin console.');
  if (resendDkim === 'missing') detail.push('Resend DKIM (resend._domainkey) is not published.');
  if (dm === 'missing') detail.push(`No DMARC record (_dmarc.${domain}).`);
  return { spf, googleDkim, resendDkim, dmarc: dm, detail };
}

/** What an admin needs to know about email, without exposing any secret. */
export async function mailHealth(): Promise<MailHealth> {
  const from = fromHeader();
  const domain = addressOf(from).split('@')[1] ?? '';
  const apiKey = process.env.RESEND_API_KEY;
  const transport = mailTransport();
  const records = domain ? await domainRecords(domain) : { spf: 'unknown' as const, googleDkim: 'unknown' as const, resendDkim: 'unknown' as const, dmarc: 'unknown' as const, detail: [] };
  const base = { transport, apiKeySet: !!apiKey, from, domain, adminAlertsTo: !!process.env.ADMIN_EMAIL, records };

  // Sending as the school's own mailbox: no DNS is involved, so the only
  // question is whether the Workspace admin has allowed it.
  if (transport === 'workspace') {
    const subject = googleSubject();
    const token = await googleToken([GMAIL_SEND]);
    const ok = 'token' in token;
    const problem = 'error' in token ? token.error : '';
    return {
      ...base,
      from: `${from.replace(/\s*<[^>]*>\s*/, '').trim() || 'Veveaham Alumni'} <${subject}>`,
      domainStatus: 'not-used',
      workspace: { subject, ok, problem },
      hint: ok
        ? (base.adminAlertsTo ? `Email is working, sent from ${subject}.` : `Email is working, but ADMIN_EMAIL is not set, so new-registration alerts have nowhere to go.`)
        : problem,
    };
  }

  if (!apiKey) {
    return {
      ...base, domainStatus: 'unknown',
      hint: 'No way to send email is configured. Set GOOGLE_SERVICE_ACCOUNT_JSON in Vercel to send as the school’s own '
        + 'mailbox (no DNS needed), or RESEND_API_KEY to send through Resend.',
    };
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
