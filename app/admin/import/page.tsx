'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { fetchApprovedOptions, fetchOptionAliases } from '../../../lib/publicData';
import { normText } from '../../../lib/exams';
import { branchVocab, examVocab } from '../../../lib/forms/vocab';
import {
  TEMPLATE, autoMap, parseCsv, readEmail, readPhone, readTable, templateCsv,
  type ImportRow, type Mapping,
} from '../../../lib/importer';
import { emailKey, phoneKey } from '../../../lib/contactKeys';
import { ConfirmAction } from '../ui';

/**
 * Bringing a batch in from the school's sheet.
 *
 * Load → match columns → check every row → confirm the colleges → create
 * hidden profiles → invite. Nothing is created until the office presses the
 * button, and what is created is hidden: pending, not agreed to, no login,
 * nothing sent. Each student is invited later by email and WhatsApp, and
 * nothing of theirs is public until they agree and the school approves.
 *
 * The sheet can be the school's template - every field the platform holds,
 * filled from the ERP - or the raw Google Form export; the columns are matched
 * either way and can be changed. See /admin/import/format for the template.
 */

type Step = 'load' | 'check' | 'done';
type Hit = { id: string; name: string; state?: string | null; district?: string | null; matched_alias?: string | null };
type CollegeChoice = { typed: string; hits: Hit[]; chosen: string | 'typed' | 'loading' };
type Result = { key: string; status: 'created' | 'exists' | 'error'; id?: string; message?: string };

const FIELD_CHOICES = [
  ...TEMPLATE.map((c) => ({ key: c.key, label: `${c.group} · ${c.header}` })),
  { key: 'exams_multi', label: 'Exams written · a list, comma-separated (the form)' },
  { key: 'exams_other', label: 'Exams written · anything else they typed (the form)' },
];

const compact = (s: string) => normText(s).replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const THIS_YEAR = new Date().getFullYear();

async function bearer(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function ImportPage() {
  const [step, setStep] = useState<Step>('load');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [fileName, setFileName] = useState('');
  const [link, setLink] = useState('');
  const [classOf, setClassOf] = useState(String(THIS_YEAR));
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [format, setFormat] = useState('');
  const [vocab, setVocab] = useState<{ exams: ReturnType<typeof examVocab>; branches: ReturnType<typeof branchVocab> } | null>(null);
  const [existing, setExisting] = useState<Map<string, string>>(new Map());
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [colleges, setColleges] = useState<Record<string, CollegeChoice>>({});
  const [filter, setFilter] = useState<'all' | 'held' | 'warned'>('all');
  const [results, setResults] = useState<Result[]>([]);
  const [batch, setBatch] = useState<string | null>(null);
  const [invites, setInvites] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');

  const rows: ImportRow[] = useMemo(() => {
    if (!vocab || table.length < 2) return [];
    const read = readTable(table, mapping, { classOf: parseInt(classOf, 10) || null, ...vocab });
    for (const r of read) {
      const who = existing.get(`e:${emailKey(r.payload.personal_email) ?? ''}`)
        ?? existing.get(`p:${phoneKey(r.payload.phone_country_code, r.payload.phone_number) ?? ''}`);
      if (who) r.problems.push(`Already on the site as ${who}`);
    }
    return read;
  }, [table, mapping, classOf, vocab, existing]);

  const included = rows.filter((r) => !excluded.has(r.line));
  const ready = included.filter((r) => r.problems.length === 0);
  const held = rows.filter((r) => r.problems.length > 0);
  const warned = rows.filter((r) => r.warnings.length > 0);

  // ── Loading ────────────────────────────────────────────────────────────
  async function start(t: string[][], name: string) {
    if (t.length < 2) { setError('That file has no rows under its header.'); return; }
    setError('');
    const [opts, al] = await Promise.all([fetchApprovedOptions(), fetchOptionAliases()]);
    const v = { exams: examVocab(opts, al), branches: branchVocab(opts, al) };
    setVocab(v);
    const m = autoMap(t[0]);
    setTable(t); setMapping(m.mapping); setFormat(m.format); setFileName(name);
    setExcluded(new Set()); setColleges({});
    await loadExisting(t, m.mapping);
    setStep('check');
    // Only colleges someone joined or was offered: a coaching centre typed in
    // the college box by someone taking a year out is not one to match.
    const read = readTable(t, m.mapping, { classOf: parseInt(classOf, 10) || null, ...v });
    void resolveColleges([...read.map((r) => r.collegeText), ...read.flatMap((r) => r.payload.admits.map((a) => a.college_name_raw ?? ''))]);
  }

  async function onFile(file: File | null) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) { setError('Upload a .csv file — in Sheets or Excel, use File → Download / Save as → CSV.'); return; }
    setBusy('file');
    try { await start(parseCsv(await file.text()), file.name); } finally { setBusy(''); }
  }

  async function onLink() {
    setBusy('link'); setError('');
    try {
      const token = await bearer();
      if (!token) { setError('Your session expired — sign in again.'); return; }
      const res = await fetch('/api/admin/import/sheet', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: link }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? 'Could not read that sheet.'); return; }
      await start(body.rows as string[][], body.title ?? 'Google Sheet');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy('');
    }
  }

  /** Who is already on the site, by email and phone - so nobody is created twice. */
  async function loadExisting(t: string[][], m: Mapping) {
    const pick = (key: string) => t.slice(1).map((r) => (m[key] ?? []).map((i) => r[i] ?? '').find((v) => v.trim()) ?? '');
    // Read exactly as the rows will be - a spreadsheet's 9.87654321E9 included.
    const emails = [...new Set(pick('email').map((e) => emailKey(readEmail(e).email)).filter(Boolean) as string[])];
    const phones = [...new Set(pick('phone').map((p) => { const r = readPhone(p); return phoneKey(r.code, r.number); }).filter(Boolean) as string[])];
    const found = new Map<string, string>();
    for (let i = 0; i < emails.length; i += 100) {
      const { data } = await supabase.from('alumni').select('full_name, email_key').in('email_key', emails.slice(i, i + 100));
      for (const r of (data ?? []) as { full_name: string; email_key: string }[]) found.set(`e:${r.email_key}`, r.full_name);
    }
    for (let i = 0; i < phones.length; i += 100) {
      const { data } = await supabase.from('alumni').select('full_name, phone_key').in('phone_key', phones.slice(i, i + 100));
      for (const r of (data ?? []) as { full_name: string; phone_key: string }[]) found.set(`p:${r.phone_key}`, r.full_name);
    }
    setExisting(found);
  }

  /**
   * Each distinct college, searched once. A hit is chosen for the office only
   * when it is that name or one of its known aliases; anything looser is
   * offered, never taken - "Amitra" once suggested Sangamitra College of
   * Education with some confidence.
   */
  async function resolveColleges(typed: string[]) {
    const names = [...new Set(typed.map((n) => n.trim()).filter((n) => n && compact(n).length >= 2))];
    const init: Record<string, CollegeChoice> = {};
    for (const n of names) init[compact(n)] = { typed: n, hits: [], chosen: 'loading' };
    setColleges(init);
    for (const n of names) {
      const { data } = await supabase.rpc('search_institutes', { p_query: n, p_kind: 'college', p_limit: 3 });
      const hits = ((data as Hit[]) ?? []).slice(0, 3);
      const sure = hits.find((h) => compact(h.name) === compact(n) || (h.matched_alias && compact(h.matched_alias) === compact(n)));
      setColleges((c) => ({ ...c, [compact(n)]: { typed: n, hits, chosen: sure ? sure.id : 'typed' } }));
    }
  }

  // ── Creating ───────────────────────────────────────────────────────────
  async function create() {
    setBusy('create'); setError('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const { data: b, error: bErr } = await supabase.from('import_batches').insert({
        file_name: fileName.slice(0, 200), class_of: parseInt(classOf, 10) || null,
        created_by_email: session.session?.user.email ?? null,
      }).select('id').single();
      if (bErr || !b) throw bErr ?? new Error('Could not start the batch.');
      setBatch(b.id);
      const idFor = (name: string | null) => {
        const c = name ? colleges[compact(name)] : undefined;
        return c && c.chosen !== 'typed' && c.chosen !== 'loading' ? c.chosen : null;
      };
      const payloads = ready.map((r) => ({
        ...r.payload,
        college_id: idFor(r.payload.college_name_raw),
        admits: r.payload.admits.map((a) => ({ ...a, college_id: idFor(a.college_name_raw) })),
      }));
      const out: Result[] = [];
      for (let i = 0; i < payloads.length; i += 25) {
        const { data, error: e } = await supabase.rpc('admin_import_rows', { p_batch: b.id, p_rows: payloads.slice(i, i + 25) });
        if (e) {
          for (const p of payloads.slice(i, i + 25)) out.push({ key: p.import_key, status: 'error', message: e.message });
        } else {
          out.push(...((data as { rows: Result[] }).rows ?? []));
        }
        setResults([...out]);
      }
      const created = out.filter((r) => r.status === 'created').length;
      await supabase.rpc('admin_log_event', {
        p_subject_kind: 'import', p_subject_id: b.id, p_alumni_id: null, p_action: 'import',
        p_summary: `Imported ${created} hidden profile(s) from ${fileName}`, p_reason: null, p_before: null, p_after: null, p_undoable: false,
      });
      setStep('done');
    } catch (e: any) {
      setError(`Could not create them: ${e?.message ?? e}`);
    } finally {
      setBusy('');
    }
  }

  async function discard() {
    if (!batch) return;
    const { data, error: e } = await supabase.rpc('admin_discard_import_batch', { p_batch: batch });
    if (e) { setError(e.message); return; }
    setError('');
    setResults([]);
    setStep('load');
    setBatch(null);
    setNote(`Taken back: ${(data as { removed: number }).removed} profile(s) removed.`);
  }

  /**
   * Email everyone who has an address, one at a time.
   *
   * The mail plan sends 100 a day, so a batch of two hundred cannot all go at
   * once. The loop stops the moment the provider says so and says what is
   * left - the rest go tomorrow, or by WhatsApp from their own page, which
   * has no cap at all.
   */
  async function emailEveryone() {
    const token = await bearer();
    if (!token) { setError('Your session expired — sign in again.'); return; }
    const byKey = new Map(ready.map((r) => [r.payload.import_key, r.payload]));
    const created = results.filter((x) => x.status === 'created' && x.id);
    let sent = 0;
    for (const [i, r] of created.entries()) {
      if (invites[r.id!] === 'emailed') continue;
      if (!byKey.get(r.key)?.personal_email) { setInvites((s) => ({ ...s, [r.id!]: 'no email' })); continue; }
      setInvites((s) => ({ ...s, [r.id!]: 'sending…' }));
      try {
        const res = await fetch('/api/admin/invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ alumni_id: r.id, channel: 'email' }),
        });
        const body = await res.json();
        if (res.ok && body.emailed) { sent += 1; setInvites((s) => ({ ...s, [r.id!]: 'emailed' })); }
        else if (body.emailProblem === 'rate-limited') {
          setInvites((s) => ({ ...s, [r.id!]: 'not sent — the day’s limit' }));
          setNote(`Emailed ${sent}. Today's sending limit is reached, with ${created.length - i} still to go — press this again tomorrow `
            + '(anyone already emailed is skipped while this page stays open), or send the rest by WhatsApp from their own page.');
          return;
        } else {
          setInvites((s) => ({ ...s, [r.id!]: !res.ok ? (body.error ?? 'failed') : `not sent (${body.emailProblem})` }));
        }
      } catch {
        setInvites((s) => ({ ...s, [r.id!]: 'failed' }));
      }
      await new Promise((ok) => setTimeout(ok, 400));
    }
    setNote(`Emailed ${sent} of ${created.length}.`);
  }

  function downloadTemplate() {
    const blob = new Blob([templateCsv()], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'veveaham-alumni-import-template.csv'; a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── Screens ────────────────────────────────────────────────────────────
  const unresolved = Object.values(colleges).filter((c) => c.chosen === 'loading').length;
  const shown = filter === 'held' ? held : filter === 'warned' ? warned : rows;

  return (
    <div className="import">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Import from the school&apos;s sheet</h2>
        <p className="subtitle" style={{ fontSize: '0.9rem' }}>
          Creates <strong>hidden</strong> profiles: nothing is public and nothing is sent until you invite each
          person and they agree. <Link href="/admin/import/format">What to put in the sheet →</Link>{' '}
          <button type="button" className="link-btn" onClick={downloadTemplate}>Download the template (CSV)</button>
        </p>
        {error && <div className="alert alert--error">{error}</div>}
        {note && <div className="alert alert--success">{note}</div>}

        {step === 'load' && (
          <div className="import__load">
            <div className="two-col">
              <div className="field">
                <label htmlFor="imp-year">Class of, for rows that do not say</label>
                <input id="imp-year" type="text" inputMode="numeric" value={classOf}
                  onChange={(e) => setClassOf(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="imp-file">Upload a CSV</label>
              <input id="imp-file" type="file" accept=".csv,text/csv" disabled={!!busy} onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="field">
              <label htmlFor="imp-link">…or paste a Google Sheet link</label>
              <div className="import__link">
                <input id="imp-link" type="url" value={link} placeholder="https://docs.google.com/spreadsheets/d/…"
                  onChange={(e) => setLink(e.target.value)} />
                <button type="button" className="btn btn--primary" disabled={!link.trim() || !!busy} onClick={() => void onLink()}>
                  <span className="btn__inner">{busy === 'link' ? 'Reading…' : 'Read the sheet'}</span>
                </button>
              </div>
              <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                Share it with alumni@dpmschools.com (Viewer). Until the one-time Google setup is done, a sheet set
                to “Anyone with the link can view” also works.
              </span>
            </div>
          </div>
        )}

        {step === 'check' && (
          <>
            <p className="import__summary">
              <strong>{fileName}</strong> · {rows.length} row(s) ·{' '}
              {format === 'form' ? 'the school’s Google Form export' : format === 'template' ? 'the school template' : 'mixed columns'} ·{' '}
              <span className="badge badge--sm badge--ok">{ready.length} ready</span>{' '}
              {held.length > 0 && <span className="badge badge--sm">{held.length} held</span>}{' '}
              {warned.length > 0 && <span className="badge badge--sm">{warned.length} with a note</span>}
              <button type="button" className="link-btn" style={{ marginLeft: 10 }} onClick={() => setStep('load')}>Start again</button>
            </p>

            <details className="import__section">
              <summary>Columns — {Object.keys(mapping).length} matched</summary>
              <table className="import__map">
                <tbody>
                  {table[0].map((h, i) => {
                    const key = Object.entries(mapping).find(([, idx]) => idx.includes(i))?.[0] ?? '';
                    return (
                      <tr key={i}>
                        <td>{h || <em>(no header)</em>}</td>
                        <td>
                          <select value={key} onChange={(e) => setMapping((m) => {
                            const next: Mapping = {};
                            for (const [k, idx] of Object.entries(m)) { const rest = idx.filter((x) => x !== i); if (rest.length) next[k] = rest; }
                            if (e.target.value) next[e.target.value] = [...(next[e.target.value] ?? []), i].sort((a, b) => a - b);
                            return next;
                          })}>
                            <option value="">— not imported —</option>
                            {FIELD_CHOICES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>

            <details className="import__section" open>
              <summary>
                Colleges — {Object.values(colleges).filter((c) => c.chosen !== 'typed' && c.chosen !== 'loading').length} of{' '}
                {Object.keys(colleges).length} matched{unresolved ? ` (searching ${unresolved}…)` : ''}
              </summary>
              <p className="hint" style={{ display: 'block', margin: '6px 0 10px' }}>
                Only an exact name or known alias is chosen for you. Pick the right one for the rest, or keep what
                they typed — it goes to the unmatched-names queue, where you can link it later.
              </p>
              <ul className="import__colleges">
                {Object.entries(colleges).sort((a, b) => a[1].typed.localeCompare(b[1].typed)).map(([k, c]) => (
                  <li key={k}>
                    <span className="import__typed">{c.typed}</span>
                    {c.chosen === 'loading' ? <span className="hint">searching…</span> : (
                      <select value={c.chosen} onChange={(e) => setColleges((all) => ({ ...all, [k]: { ...c, chosen: e.target.value } }))}>
                        <option value="typed">Keep as typed</option>
                        {c.hits.map((h) => (
                          <option key={h.id} value={h.id}>{h.name}{h.district || h.state ? ` — ${[h.district, h.state].filter(Boolean).join(', ')}` : ''}</option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </details>

            <div className="chips" style={{ margin: '14px 0 8px' }}>
              {(['all', 'held', 'warned'] as const).map((f) => (
                <button key={f} type="button" className={`chip${filter === f ? ' chip--active' : ''}`} onClick={() => setFilter(f)}>
                  {f === 'all' ? `All ${rows.length}` : f === 'held' ? `Held ${held.length}` : `With a note ${warned.length}`}
                </button>
              ))}
            </div>
            <div className="import__rows">
              {shown.map((r) => (
                <div key={r.line} className={`import-row${r.problems.length ? ' import-row--held' : ''}${excluded.has(r.line) ? ' import-row--out' : ''}`}>
                  <label className="import-row__pick">
                    <input type="checkbox" checked={!excluded.has(r.line) && !r.problems.length} disabled={!!r.problems.length}
                      onChange={() => setExcluded((s) => { const n = new Set(s); if (n.has(r.line)) n.delete(r.line); else n.add(r.line); return n; })} />
                    <span className="sr-only">Include row {r.line}</span>
                  </label>
                  <div className="import-row__body">
                    <div className="import-row__head">
                      <span className="import-row__line">Row {r.line}</span> <strong>{r.payload.full_name || '—'}</strong>
                      <span className="import-row__meta">
                        {[r.payload.class_of, r.payload.school_name?.replace(/Veveaham |Higher Secondary School|Matric /g, ''),
                          r.payload.in_gap_year ? 'year out' : null].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <div className="import-row__meta">
                      {[r.payload.college_name_raw, [r.payload.degree, r.payload.branch].filter(Boolean).join(' '),
                        r.payload.exam_attempts.length ? `wrote ${r.payload.exam_attempts.map((a) => a.exam).join(', ')}` : null,
                        r.payload.private.guardian1_name ? `parent ✓` : null,
                        r.payload.personal_email ? 'email ✓' : 'no email', r.payload.phone_number ? 'phone ✓' : 'no phone']
                        .filter(Boolean).join(' · ')}
                    </div>
                    {r.problems.map((p) => <div key={p} className="import-row__problem">✕ {p}</div>)}
                    {r.warnings.map((w) => <div key={w} className="import-row__warn">• {w}</div>)}
                  </div>
                </div>
              ))}
            </div>

            <div className="queue__actions" style={{ marginTop: 16 }}>
              <ConfirmAction
                label={`Create ${ready.length} hidden profile${ready.length === 1 ? '' : 's'}`}
                confirmLabel={`Yes, create ${ready.length}`} busyLabel="Creating…" wide
                question={<>Create <strong>{ready.length}</strong> hidden profiles? They are <strong>not public</strong>, and <strong>nothing is sent</strong> to anyone. You can take the whole batch back until someone claims theirs.</>}
                onConfirm={() => create()}
              />
              {unresolved > 0 && <span className="queue__held">Still matching {unresolved} college name(s)…</span>}
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="import__summary">
              <span className="badge badge--sm badge--ok">{results.filter((r) => r.status === 'created').length} created</span>{' '}
              <span className="badge badge--sm">{results.filter((r) => r.status === 'exists').length} already imported</span>{' '}
              <span className="badge badge--sm">{results.filter((r) => r.status === 'error').length} not created</span>
            </p>
            <p className="subtitle" style={{ fontSize: '0.88rem' }}>
              They are hidden and waiting under <Link href="/admin/people?need=imported">People → Imported</Link>. Open anyone to
              add what the sheet did not have, then invite them — by email here, or one by one from their page for WhatsApp.
            </p>
            <div className="queue__actions">
              <button type="button" className="btn btn--primary" onClick={() => void emailEveryone()}>
                <span className="btn__inner">✉ Email a claim link to everyone with an email</span>
              </button>
              <ConfirmAction
                label="Take this import back" confirmLabel="Yes, remove them" busyLabel="Removing…" wide
                question="Remove every profile this import created that nobody has claimed yet? Claimed or approved ones stay."
                onConfirm={() => discard()}
              />
            </div>
            <ul className="import__results">
              {results.map((r) => (
                <li key={r.key}>
                  <span className={`badge badge--xs${r.status === 'created' ? ' badge--ok' : ''}`}>{r.status}</span>{' '}
                  {r.id ? <Link href={`/admin/people/${r.id}`}>{ready.find((x) => x.payload.import_key === r.key)?.payload.full_name ?? r.key}</Link>
                    : (ready.find((x) => x.payload.import_key === r.key)?.payload.full_name ?? r.key)}
                  {r.message && <span className="hint"> — {r.message}</span>}
                  {r.id && invites[r.id] && <span className="hint"> · {invites[r.id]}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
