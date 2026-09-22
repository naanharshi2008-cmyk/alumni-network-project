import { createSign } from 'crypto';
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/supabaseAdmin';
import { parseCsv } from '../../../../../lib/importer';

/**
 * Read a Google Sheet for the import, from the link the office pastes.
 *
 * Two ways in, tried in order:
 *
 * 1. The school's service account (GOOGLE_SERVICE_ACCOUNT_JSON in Vercel),
 *    which the Workspace admin allows - domain-wide delegation, one read-only
 *    scope - to act as alumni@dpmschools.com. The office then only has to
 *    share the sheet with alumni@, inside the school's own domain. The JWT is
 *    signed with Node's crypto: no new dependency. The key never leaves the
 *    server.
 * 2. A sheet anyone with the link can view, read as CSV. Works with no setup,
 *    for a sheet the office is happy to share that way.
 *
 * Only Google's own hosts are ever fetched, with an id checked to be an id.
 */

export const runtime = 'nodejs';

const SUBJECT = process.env.GOOGLE_SHEETS_SUBJECT || 'alumni@dpmschools.com';
const MAX_ROWS = 5000;

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

async function serviceAccountToken(): Promise<{ token: string } | { error: string } | null> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  let key: { client_email?: string; private_key?: string };
  try { key = JSON.parse(raw); } catch { return { error: 'The Google service account key in Vercel is not valid JSON.' }; }
  if (!key.client_email || !key.private_key) return { error: 'The Google service account key in Vercel is incomplete.' };
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email, sub: SUBJECT, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(key.private_key.replace(/\\n/g, '\n'));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${claims}.${b64url(signature)}`,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    return {
      error: body.error === 'unauthorized_client'
        ? 'Google has not allowed the site to read sheets yet — the Workspace admin needs to grant the domain-wide delegation.'
        : `Google refused the site's sign-in (${body.error ?? res.status}).`,
    };
  }
  return { token: body.access_token };
}

async function viaServiceAccount(token: string, id: string, gid: string | null) {
  const auth = { Authorization: `Bearer ${token}` };
  const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties(sheetId,title)`, { headers: auth });
  if (meta.status === 403 || meta.status === 404) {
    return { error: `The site cannot open that sheet. Share it with ${SUBJECT} (Viewer is enough) and try again.` };
  }
  if (!meta.ok) return { error: `Google answered ${meta.status} for that sheet.` };
  const m = (await meta.json()) as { properties?: { title?: string }; sheets?: { properties: { sheetId: number; title: string } }[] };
  const tab = m.sheets?.find((s) => String(s.properties.sheetId) === gid) ?? m.sheets?.[0];
  if (!tab) return { error: 'That spreadsheet has no sheets.' };
  const values = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(tab.properties.title)}`
      + '?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING',
    { headers: auth },
  );
  if (!values.ok) return { error: `Google answered ${values.status} when reading the sheet.` };
  const v = (await values.json()) as { values?: unknown[][] };
  // Unformatted, so a mobile number arrives as 9876543210 rather than the
  // 9.88E+09 a number-formatted column would display.
  const rows = (v.values ?? []).map((r) => r.map((c) => (c == null ? '' : typeof c === 'number' ? (Number.isInteger(c) ? c.toFixed(0) : String(c)) : String(c))));
  return { rows, title: `${m.properties?.title ?? 'Sheet'} — ${tab.properties.title}`, source: 'service-account' as const };
}

async function viaPublicLink(id: string, gid: string | null) {
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
  const res = await fetch(url, { redirect: 'follow' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !/text\/csv|text\/plain/.test(type)) return null;
  const rows = parseCsv(await res.text());
  return { rows, title: 'Google Sheet', source: 'public-link' as const };
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  let link = '';
  try { link = String(((await request.json()) as { url?: string }).url ?? '').trim(); } catch { /* handled below */ }
  const id = link.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
  if (!id) return NextResponse.json({ error: 'That is not a Google Sheets link. Open the sheet and copy the address from the browser.' }, { status: 400 });
  const gid = link.match(/[#&?]gid=(\d+)/)?.[1] ?? null;

  const sa = await serviceAccountToken();
  let saProblem = '';
  if (sa && 'token' in sa) {
    const out = await viaServiceAccount(sa.token, id, gid);
    if ('rows' in out && out.rows) return NextResponse.json({ ...out, rows: out.rows.slice(0, MAX_ROWS + 1) });
    saProblem = 'error' in out && out.error ? out.error : 'Google did not return the sheet.';
  } else if (sa && 'error' in sa) {
    saProblem = sa.error;
  }

  const open = await viaPublicLink(id, gid);
  if (open) return NextResponse.json({ ...open, rows: open.rows.slice(0, MAX_ROWS + 1) });

  return NextResponse.json({
    error: saProblem
      || 'The site cannot read that sheet yet. Until the one-time Google setup is done, either set the sheet to '
        + '“Anyone with the link can view”, or use File → Download → CSV and upload the file here.',
  }, { status: 403 });
}
