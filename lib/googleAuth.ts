import 'server-only';
import { createSign } from 'crypto';

/**
 * Acting as the school's own Google account, from the server.
 *
 * One service account (GOOGLE_SERVICE_ACCOUNT_JSON in Vercel), allowed by the
 * Workspace admin to act as alumni@dpmschools.com for two narrow scopes:
 * sending mail, and reading a spreadsheet. That is what lets the site send
 * from the school's real address without a single DNS change, and read an
 * import sheet the office has shared with alumni@.
 *
 * The JWT is signed with Node's own crypto - no dependency - and the key
 * never leaves the server. Tokens are cached in memory until they expire.
 */

export const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';
export const SHEETS_READ = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** The mailbox the service account acts as. */
export function googleSubject(): string {
  return process.env.GOOGLE_SHEETS_SUBJECT || process.env.GOOGLE_MAIL_SUBJECT || 'alumni@dpmschools.com';
}

export function googleConfigured(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

type Key = { client_email?: string; private_key?: string; client_id?: string };

function readKey(): Key | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const key = JSON.parse(raw) as Key;
    return key.client_email && key.private_key ? key : null;
  } catch {
    return null;
  }
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');
const cache = new Map<string, { token: string; until: number }>();

export type TokenResult = { token: string } | { error: string };

/** An access token for these scopes, as the subject. Cached until it expires. */
export async function googleToken(scopes: string[], subject = googleSubject()): Promise<TokenResult> {
  const scope = scopes.join(' ');
  const cacheKey = `${subject}|${scope}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.until > Date.now() + 60_000) return { token: hit.token };

  const key = readKey();
  if (!key) {
    return { error: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      ? 'The Google service account key in Vercel is not valid JSON, or is missing its client_email / private_key.'
      : 'GOOGLE_SERVICE_ACCOUNT_JSON is not set in Vercel.' };
  }

  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email, sub: subject, scope,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign((key.private_key ?? '').replace(/\\n/g, '\n'));

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${head}.${claims}.${b64url(signature)}`,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      // The one error worth naming: the Workspace admin has not allowed this
      // service account to act for the school yet, or not for this scope.
      const notDelegated = body.error === 'unauthorized_client'
        || /not authorized|client is unauthorized/i.test(body.error_description ?? '');
      return {
        error: notDelegated
          ? `Google has not allowed the site to act as ${subject} yet — in the Admin console, under Security → API controls → Domain-wide delegation, the service account's client ID needs these scopes: ${scope}`
          : `Google refused the site's sign-in (${body.error ?? res.status}).`,
      };
    }
    cache.set(cacheKey, { token: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 });
    return { token: body.access_token };
  } catch {
    return { error: 'Could not reach Google to sign in.' };
  }
}
