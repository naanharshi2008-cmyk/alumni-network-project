import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/supabaseAdmin';
import { SHEETS_READ, googleConfigured, googleSubject, googleToken } from '../../../../../lib/googleAuth';
import { parseCsv } from '../../../../../lib/importer';

/**
 * Read a Google Sheet for the import, from the link the office pastes.
 *
 * Two ways in, tried in order:
 *
 * 1. The school's service account (GOOGLE_SERVICE_ACCOUNT_JSON in Vercel),
 *    which the Workspace admin allows - domain-wide delegation - to act as
 *    alumni@dpmschools.com. The office then only has to share the sheet with
 *    alumni@, inside the school's own domain. The same account sends the
 *    site's mail; see lib/googleAuth.ts.
 * 2. A sheet anyone with the link can view, read as CSV. Works with no setup,
 *    for a sheet the office is happy to share that way.
 *
 * Only Google's own hosts are ever fetched, with an id checked to be an id.
 */

export const runtime = 'nodejs';

const MAX_ROWS = 5000;

async function viaServiceAccount(token: string, id: string, gid: string | null) {
  const auth = { Authorization: `Bearer ${token}` };
  const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties(sheetId,title)`, { headers: auth });
  if (meta.status === 403 || meta.status === 404) {
    return { error: `The site cannot open that sheet. Share it with ${googleSubject()} (Viewer is enough) and try again.` };
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

  // The same service account the site sends mail as (lib/googleAuth.ts).
  let saProblem = '';
  if (googleConfigured()) {
    const sa = await googleToken([SHEETS_READ]);
    if ('token' in sa) {
      const out = await viaServiceAccount(sa.token, id, gid);
      if ('rows' in out && out.rows) return NextResponse.json({ ...out, rows: out.rows.slice(0, MAX_ROWS + 1) });
      saProblem = 'error' in out && out.error ? out.error : 'Google did not return the sheet.';
    } else {
      saProblem = sa.error;
    }
  }

  const open = await viaPublicLink(id, gid);
  if (open) return NextResponse.json({ ...open, rows: open.rows.slice(0, MAX_ROWS + 1) });

  return NextResponse.json({
    error: saProblem
      || 'The site cannot read that sheet yet. Until the one-time Google setup is done, either set the sheet to '
        + '“Anyone with the link can view”, or use File → Download → CSV and upload the file here.',
  }, { status: 403 });
}
