#!/usr/bin/env node
/**
 * Post-migration security check.
 *
 * Run this AFTER applying migrations/02_lockdown.sql in the Supabase SQL
 * editor (which itself comes after 01_additive.sql and the deploy). It uses
 * only the public anon key - exactly what any visitor's browser holds - and
 * confirms the contact-details leak is actually closed in production rather
 * than merely closed in the code.
 *
 *   node scripts/verify_security.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY from the
 * environment or .env.local.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = { ...process.env };
  const file = join(root, '.env.local');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL_ || !KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or create .env.local).');
  process.exit(2);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const rest = `${URL_.replace(/\/$/, '')}/rest/v1`;

let failures = 0;
const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const fail = (m) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };

async function get(path, init) {
  const res = await fetch(`${rest}${path}`, { headers, ...init });
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

console.log('\nChecking as an anonymous visitor…\n');

// 1. The leak itself: contact columns must be unreachable.
{
  const { status, body } = await get('/alumni?approval_status=eq.approved&select=personal_email,phone_number&limit=1');
  const leaked = Array.isArray(body) && body.some((r) => r.personal_email || r.phone_number);
  if (leaked) fail(`anon can STILL read contact details (HTTP ${status}) — has migrations/02_lockdown.sql been run?`);
  else pass(`contact details are not readable (HTTP ${status})`);
}

// 2. The whole raw table should be closed to anon.
{
  const { status } = await get('/alumni?select=id&limit=1');
  if (status === 200) fail('anon can still SELECT from the alumni table — the REVOKE did not apply');
  else pass(`raw alumni table is closed to anon (HTTP ${status})`);
}

// 3. The public view must work, and must not carry private columns.
{
  const { status, body } = await get('/public_alumni?select=*&limit=1');
  if (status !== 200 || !Array.isArray(body)) {
    fail(`public_alumni is not readable (HTTP ${status}) — the directory will be empty`);
  } else {
    pass(`public_alumni is readable (HTTP ${status})`);
    const bad = ['personal_email', 'phone_number', 'phone_country_code', 'admission_number', 'user_id', 'original_data', 'pending_changes'];
    const found = body.length ? bad.filter((c) => c in body[0]) : [];
    if (found.length) fail(`public_alumni exposes private columns: ${found.join(', ')}`);
    else pass('public_alumni exposes no private columns');
  }
}

// 4. Registration's username check must work without table access.
{
  const res = await fetch(`${rest}/rpc/username_available`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate: 'zzz_probably_free_zzz' }),
  });
  if (res.status === 200) pass('username_available RPC works (registration can check names)');
  else fail(`username_available RPC failed (HTTP ${res.status}) — registration will break`);
}

// 5. The directory must not merely "work" — it must actually return people.
//    An empty view would pass a naive HTTP check while showing visitors nothing.
{
  const { body } = await get('/public_alumni?select=id');
  const n = Array.isArray(body) ? body.length : 0;
  if (n > 0) pass(`${n} approved profile(s) visible publicly; pending ones are excluded by the view`);
  else fail('public_alumni returned 0 rows — the directory would be empty. Check the view definition.');
}

// 6/7. Public timelines must survive the revoke.
//
// This is the check that catches the subtlest failure in this migration. A
// policy written as `USING (alumni_id IN (SELECT ... FROM alumni ...))` is
// evaluated with the CALLING role's privileges, so it starts failing for anon
// the moment SELECT on alumni is revoked — silently emptying every timeline.
// The lockdown migration routes that check through a SECURITY DEFINER helper;
// these two probes prove it worked.
for (const table of ['higher_studies', 'work_experience']) {
  const { status, body } = await get(`/${table}?select=id`);
  if (status !== 200) {
    fail(`${table} not readable (HTTP ${status}) — profile timelines will be missing. ` +
         `If the error mentions "permission denied for table alumni", the RLS policy is sub-selecting ` +
         `alumni instead of using the is_approved_alumnus() helper.`);
  } else {
    const n = Array.isArray(body) ? body.length : 0;
    pass(`${table} readable by anon (${n} row(s), scoped to approved alumni)`);
  }
}

console.log(
  failures === 0
    ? '\n\x1b[32mAll checks passed.\x1b[0m The public API no longer exposes contact details.\n'
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m See above.\n`,
);
process.exit(failures === 0 ? 0 : 1);
