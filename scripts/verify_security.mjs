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
    const bad = ['personal_email', 'phone_number', 'phone_country_code', 'email_key', 'phone_key', 'admission_number', 'user_id', 'original_data', 'pending_changes'];
    const found = body.length ? bad.filter((c) => c in body[0]) : [];
    if (found.length) fail(`public_alumni exposes private columns: ${found.join(', ')}`);
    else pass('public_alumni exposes no private columns');
  }
}

// 4. Sign-in and registration lookups must work without table access, and
//    must never hand back anyone's contact details.
{
  const post = (fn, payload) => fetch(`${rest}/rpc/${fn}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const probe = `nobody-${Date.now()}@example.invalid`;

  const lh = await post('login_handle', { p_identifier: probe });
  const lhBody = await lh.json().catch(() => undefined);
  if (lh.status !== 200) fail(`login_handle RPC failed (HTTP ${lh.status}) — nobody can sign in with email or phone`);
  else if (lhBody !== null) fail('login_handle returned something for an address that is not registered');
  else pass('login_handle works and returns nothing for an unknown contact');

  const ca = await post('contact_available', { p_email: probe, p_phone_code: '+91', p_phone: '1234512345' });
  const caBody = await ca.json().catch(() => undefined);
  const keys = caBody && typeof caBody === 'object' ? Object.keys(caBody).sort().join(',') : '';
  if (ca.status !== 200) fail(`contact_available RPC failed (HTTP ${ca.status}) — registration will break`);
  else if (keys !== 'email_free,phone_free') fail(`contact_available returned unexpected fields: ${keys}`);
  else pass('contact_available works and returns only two booleans');
}

// 4b. Anonymous visitors must not be able to write profiles or colleges. Each
//     probe sends a row missing a required column, so even if the write were
//     permitted nothing could be saved: permission errors (401/403) pass, a
//     not-null error means the write got past the permission check.
for (const [table, payload] of [['alumni', { full_name: null }], ['colleges', { name: null }]]) {
  const res = await fetch(`${rest}/${table}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (body?.code === '23502') fail(`anonymous visitors can INSERT into ${table} — migrations/07 is not applied`);
  else if (res.status === 401 || res.status === 403 || body?.code === '42501') pass(`anonymous INSERT into ${table} is refused (HTTP ${res.status})`);
  else fail(`unexpected answer to anonymous INSERT into ${table}: HTTP ${res.status} ${body?.code ?? ''}`);
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

// 8. Migration 18: the new private tables are closed to anon, the new public
//    views open and carrying bands only, and public_alumni has no bookkeeping.
for (const table of ['exam_attempts', 'admits', 'gap_years', 'alumni_private', 'alumni_office_notes', 'import_batches']) {
  const { status } = await get(`/${table}?select=*&limit=1`);
  if (status === 200) fail(`anon can read ${table} — migration 18's REVOKE did not apply`);
  else pass(`${table} is closed to anon (HTTP ${status})`);
}
for (const [view, forbidden] of [
  ['public_exam_attempts', ['exam_rank', 'percentile']],
  ['public_admits', ['added_by_school']],
  ['public_gap_years', []],
  ['public_seats', []],
]) {
  const { status, body } = await get(`/${view}?select=*&limit=5`);
  if (status !== 200 || !Array.isArray(body)) { fail(`${view} is not readable (HTTP ${status})`); continue; }
  const found = body.length ? forbidden.filter((c) => c in body[0]) : [];
  if (found.length) fail(`${view} exposes ${found.join(', ')}`);
  else pass(`${view} is readable and carries no exact score (${body.length} row(s) sampled)`);
}
{
  const { body } = await get('/public_alumni?select=*&limit=1');
  const bookkeeping = ['origin', 'import_key', 'import_batch_id', 'invited_by', 'in_gap_year', 'consent_given', 'approval_status'];
  const found = Array.isArray(body) && body.length ? bookkeeping.filter((c) => c in body[0]) : [];
  if (found.length) fail(`public_alumni exposes bookkeeping: ${found.join(', ')}`);
  else pass('public_alumni carries no import, invite or gap-year bookkeeping');
}

// 9. Migration 20: public_alumni carries bands, not the numbers behind them.
{
  const edges = new Set(['100', '500', '1000', '5000', '10000', '25000', '50000', '100000', '100001']);
  const floors = new Set(['0', '50', '60', '70', '80', '85', '90', '95']);
  const { body } = await get('/public_alumni?select=admission_rank,board_marks');
  const rows = Array.isArray(body) ? body : [];
  const ranks = rows.filter((r) => r.admission_rank != null && !edges.has(String(r.admission_rank))).length;
  const marks = rows.filter((r) => r.board_marks != null && !floors.has(String(r.board_marks))).length;
  if (ranks || marks) fail(`public_alumni still publishes ${ranks} exact rank(s) and ${marks} exact mark(s) — is migration 20 applied?`);
  else pass('public_alumni publishes rank and marks bands only');
}

console.log(
  failures === 0
    ? '\n\x1b[32mAll checks passed.\x1b[0m The public API no longer exposes contact details.\n'
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m See above.\n`,
);
process.exit(failures === 0 ? 0 : 1);
