'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import EntitySearchField from '../../../../lib/EntitySearchField';
import SchoolPicker from '../../../../lib/SchoolPicker';
import OptionSearchField from '../../../../lib/OptionSearchField';
import { linkFor, toPick, type InstitutePick } from '../../../../lib/institutes';
import { cleanFreeText, cleanProperNoun } from '../../../../lib/text';
import { fetchApprovedOptions, fetchOptionAliases } from '../../../../lib/publicData';
import { COUNTRY_CODES, DEGREES, STATUSES, STREAMS, boardForSchool, mergeOptions } from '../../../../lib/options';
import { CATEGORIES, categoryForDegree } from '../../../../lib/types';
import { examAreas } from '../../../../lib/exams';
import { handleFromStored, parseLinkedIn } from '../../../../lib/linkedin';
import { phoneProblem } from '../../../../lib/contactKeys';
import AdmissionFields from '../../../../lib/forms/AdmissionFields';
import ExamAttemptsField from '../../../../lib/forms/ExamAttemptsField';
import AdmitsField from '../../../../lib/forms/AdmitsField';
import GapYearField from '../../../../lib/forms/GapYearField';
import FamilyHomeFields from '../../../../lib/forms/FamilyHomeFields';
import LinkedInField from '../../../../lib/forms/LinkedInField';
import { SelectBox, TextField } from '../../../../lib/forms/controls';
import {
  admissionColumns, admissionFromRow, admissionProblem, admitRowsWithKeys, allOffers, attemptRows, pathDraftsFromRows, newOffer, type OfferDraft,
  contextualBranchAliases, emptyAdmission, emptyFamily, emptyGap, familyFromRow, familyProblems, gapFromRows,
  gapProblem, gapRows, inGapYear, joinedCollege, privateRow, seatYear,
  type AdmissionDraft, type AdmitDraft, type AttemptDraft, type FamilyDraft, type FamilyKey, type GapDraft,
} from '../../../../lib/forms/model';
import { branchVocab, canonicalBranch, examVocab } from '../../../../lib/forms/vocab';
import { loadPathDetails, type AlumniRow } from '../../adminData';

/**
 * One profile, whole, for the school to finish.
 *
 * Profiles the school starts - one at a time, or from a sheet - arrive with a
 * name, a batch and whatever the office knew. This is where the office adds
 * the rest before the student has ever signed in: parents and address from
 * the ERP, the exams they wrote, and the offers they had ("the school's manual
 * addition"). It is built from the same pieces as registration and /profile,
 * so an answer means the same thing wherever it was typed.
 *
 * The school's writes are live - it is a trusted writer (migration 18's guard)
 * - and each save is logged. Offers entered here are marked as the school's,
 * so a student cannot remove them.
 */

type Loaded = AlumniRow & { colleges?: { name: string } | null };

export default function AdminPersonPage() {
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // The row's own fields, as the office edits them.
  const [f, setF] = useState({
    full_name: '', class_of: '', school_name: '', stream: '', personal_email: '', phone_country_code: '+91',
    phone_number: '', college: '', degree: '', branch: '', field: '', current_status: '', currently_at: '',
  });
  const [pick, setPick] = useState<InstitutePick>(null);
  const [admission, setAdmission] = useState<AdmissionDraft>(emptyAdmission());
  const [attempts, setAttempts] = useState<AttemptDraft[]>([]);
  const [admits, setAdmits] = useState<AdmitDraft[]>([]);
  // Which offers the student added themselves; everything else is the school's.
  const [studentKeys, setStudentKeys] = useState<Set<string>>(new Set());
  const [gap, setGap] = useState<GapDraft>(emptyGap());
  const [family, setFamily] = useState<FamilyDraft>(emptyFamily());
  const [familyTouched, setFamilyTouched] = useState<Partial<Record<FamilyKey, boolean>>>({});
  const [officeNote, setOfficeNote] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [showAdmits, setShowAdmits] = useState(true);
  const [seatOffer, setSeatOffer] = useState<OfferDraft | null>(null);

  const [tagOptions, setTagOptions] = useState<Record<string, string[]>>({});
  const [aliases, setAliases] = useState<Record<string, Record<string, string>>>({});
  const exams = useMemo(() => examVocab(tagOptions, aliases), [tagOptions, aliases]);
  const branches = useMemo(() => branchVocab(tagOptions, aliases), [tagOptions, aliases]);
  const degreeOptions = useMemo(() => mergeOptions(DEGREES, tagOptions.degree, aliases.degree), [tagOptions, aliases]);
  const familyErrors = useMemo(() => familyProblems(family, false, phoneProblem), [family]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error: e }, paths, opts, al] = await Promise.all([
      supabase.from('alumni').select('*, colleges(name)').eq('id', id).maybeSingle(),
      loadPathDetails([id]),
      fetchApprovedOptions(),
      fetchOptionAliases(),
    ]);
    setTagOptions(opts);
    setAliases(al);
    if (e || !data) { setError(e?.message ?? 'That profile no longer exists.'); setLoading(false); return; }
    const r = data as Loaded;
    const path = paths[id];
    setRow(r);
    setF({
      full_name: r.full_name ?? '', class_of: r.class_of ? String(r.class_of) : '', school_name: r.school_name ?? '',
      stream: r.stream ?? '', personal_email: r.personal_email ?? '', phone_country_code: r.phone_country_code ?? '+91',
      phone_number: r.phone_number ?? '', college: r.colleges?.name ?? r.college_name_raw ?? '',
      degree: r.degree ?? '', branch: r.branch ?? '', field: r.field ?? '',
      current_status: r.current_status ?? '', currently_at: r.currently_at ?? '',
    });
    setPick(r.college_id && r.colleges?.name ? { id: r.college_id, name: r.colleges.name } : null);
    setAdmission(admissionFromRow(r));
    setLinkedin(handleFromStored(r.linkedin_handle, r.linkedin_url));
    const drafts = pathDraftsFromRows(path?.attempts ?? [], path?.admits ?? [], r.class_of ?? null,
      r.admission_kind === 'entrance_exam' ? r.admission_exam : null);
    setAttempts(drafts.attempts);
    setAdmits(drafts.admits);
    setSeatOffer(drafts.seatOffer);
    setStudentKeys(new Set((path?.admits ?? []).filter((d) => !d.added_by_school).map((d) => d.id)));
    setGap(gapFromRows(path?.gapYears ?? [], !!r.in_gap_year, !!(r.college_id || (r.college_name_raw ?? '').trim())));
    setFamily(familyFromRow(path?.private));
    setOfficeNote(path?.officeNote ?? '');
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!row) return;
    setError(''); setNote('');
    const joined = joinedCollege(gap);
    const named = joined && !!f.college.trim();
    const problem = (f.full_name.trim().length < 2 && 'Enter their full name.')
      || gapProblem(gap)
      || (named ? admissionProblem(admission, false) : '')
      || (f.phone_number.trim() ? phoneProblem(f.phone_country_code, f.phone_number) : '')
      || parseLinkedIn(linkedin).problem
      || Object.values(familyErrors).find(Boolean);
    if (problem) { setError(problem); return; }

    setSaving(true);
    try {
      const classOf = parseInt(f.class_of, 10) || null;
      const degree = named ? cleanFreeText(f.degree) : null;
      const collegeId = named ? await linkFor('college', cleanProperNoun(f.college), pick) : null;
      const gapArea = !named && gap.afterSchool === 'gap' ? examAreas(gap.exam)[0] : undefined;
      const field = cleanFreeText(f.field)
        || categoryForDegree(degree, named ? f.branch : '', null)?.label
        || CATEGORIES.find((c) => c.key === gapArea)?.label
        || null;

      const { error: upErr } = await supabase.from('alumni').update({
        full_name: f.full_name.trim(),
        class_of: classOf,
        school_name: f.school_name || null,
        school_board: f.school_name ? boardForSchool(f.school_name) : null,
        stream: f.stream || null,
        personal_email: f.personal_email.trim().toLowerCase() || null,
        phone_country_code: f.phone_number.trim() ? f.phone_country_code : null,
        phone_number: f.phone_number.replace(/\D/g, '') || null,
        college_id: collegeId,
        college_name_raw: named ? cleanProperNoun(f.college) : null,
        degree,
        branch: named ? cleanProperNoun(canonicalBranch(f.branch, branches, contextualBranchAliases(f.degree))) : null,
        field,
        ...admissionColumns(named ? admission : emptyAdmission(), exams.aliases),
        in_gap_year: inGapYear(gap),
        current_status: f.current_status || null,
        currently_at: cleanProperNoun(f.currently_at),
        linkedin_handle: parseLinkedIn(linkedin).handle,
      }).eq('id', row.id);
      if (upErr) throw upErr;

      // The lists, replaced whole. The school may change any offer; each
      // keeps whose it was, and a new one is the school's.
      const year = seatYear(gap, classOf);
      const attemptPayload = attemptRows(attempts, { admission: named ? admission : emptyAdmission(), year, attemptYear: classOf }, exams.aliases);
      const offers = allOffers(
        named ? admits : [], attempts,
        named && admission.kind === 'entrance_exam' ? { exam: admission.exam, offer: seatOffer } : null,
      ).filter((d) => d.college.trim() || d.pick);
      const ids: Record<string, string | null> = {};
      for (const d of offers) ids[d.key] = await linkFor('college', cleanProperNoun(d.college), d.pick);
      // Keyed rows, not positional: admitRows drops a duplicate, so the nth
      // row is no longer the nth draft and "whose offer is this?" would land
      // on the wrong one.
      const admitPayload = admitRowsWithKeys(offers, year, ids, exams.aliases).map(({ key, row }) => ({
        ...row,
        branch: row.branch ? cleanProperNoun(canonicalBranch(row.branch, branches, contextualBranchAliases(row.degree ?? ''))) : null,
        added_by_school: !studentKeys.has(key),
      }));
      const gapPayload = gapRows(gap, classOf, exams.aliases);
      for (const [table, rows] of [['exam_attempts', attemptPayload], ['admits', admitPayload], ['gap_years', gapPayload]] as const) {
        const { error: delErr } = await supabase.from(table).delete().eq('alumni_id', row.id);
        if (delErr) throw delErr;
        if (rows.length) {
          const { error: insErr } = await supabase.from(table).insert((rows as Record<string, unknown>[]).map((x) => ({ ...x, alumni_id: row.id })));
          if (insErr) throw insErr;
        }
      }

      const { error: privErr } = await supabase.from('alumni_private')
        .upsert({ alumni_id: row.id, ...privateRow(family), source: 'school' }, { onConflict: 'alumni_id' });
      if (privErr) throw privErr;
      const { error: noteErr } = await supabase.from('alumni_office_notes')
        .upsert({ alumni_id: row.id, note: officeNote.trim() || null }, { onConflict: 'alumni_id' });
      if (noteErr) throw noteErr;

      await supabase.rpc('admin_log_event', {
        p_subject_kind: 'profile', p_subject_id: row.id, p_alumni_id: row.id, p_action: 'publish',
        p_summary: `The school edited ${f.full_name.trim()}`, p_reason: null, p_before: null, p_after: null, p_undoable: false,
      });
      setNote('Saved.');
      await load();
    } catch (e: any) {
      const m = String(e?.message ?? e);
      setError(/email_key/.test(m) ? 'That email is already on another profile.'
        : /phone_key/.test(m) ? 'That phone number is already on another profile.'
          : `Could not save: ${m}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="subtitle">Loading…</p>;
  if (!row) return <div className="alert alert--error">{error || 'That profile no longer exists.'}</div>;

  const joinedNow = joinedCollege(gap);
  const named = joinedNow && !!f.college.trim();
  const classOfNum = parseInt(f.class_of, 10) || null;
  const areaKey = joinedNow ? (categoryForDegree(f.degree, f.branch, null)?.key ?? null) : (examAreas(gap.exam)[0] ?? null);

  return (
    <div className="admin-person">
      <p className="crumb"><Link href="/admin/people">← People</Link></p>
      <div className="card">
        <div className="admin-person__head">
          <h2 style={{ margin: 0 }}>{row.full_name}</h2>
          <div className="pr__badges">
            <span className="badge badge--xs">{row.approval_status === 'approved' ? 'in the directory' : row.approval_status === 'rejected' ? 'hidden' : 'not published'}</span>
            {row.origin === 'import' && <span className="badge badge--xs">imported</span>}
            {row.origin === 'school' && <span className="badge badge--xs">started by the school</span>}
            {row.consent_given === false && <span className="badge badge--xs">not agreed yet</span>}
            {!row.user_id && <span className="badge badge--xs">no login yet</span>}
            {row.in_gap_year && <span className="badge badge--xs">in a year out</span>}
          </div>
          {row.approval_status === 'approved' && row.public_slug && (
            <Link href={`/alumni/${row.public_slug}`} className="link-btn">Their public page ↗</Link>
          )}
        </div>
        {row.modification_status === 'pending' && (
          <p className="form-note form-note--warm">
            They have an edit waiting in <Link href="/admin/review">Review</Link>. What you save here goes live
            now; their edit stays waiting, and is compared with this when you review it.
          </p>
        )}

        <InvitePanel person={row} />

        {error && <div className="alert alert--error" style={{ marginTop: 14 }}>{error}</div>}
        {note && <div className="alert alert--success" style={{ marginTop: 14 }}>{note}</div>}

        <h3 className="step-subhead">The basics</h3>
        <TextField label="Full name" required value={f.full_name} onChange={(v) => set('full_name', v)} />
        <div className="two-col">
          <TextField label="Class of" required inputMode="numeric" value={f.class_of} onChange={(v) => set('class_of', v.replace(/\D/g, '').slice(0, 4))} />
          <SelectBox label="Stream" value={f.stream} options={STREAMS.filter((s) => s !== 'Other')} placeholder="—" onChange={(v) => set('stream', v)} />
        </div>
        <div className="field">
          <label id="ap-school">School</label>
          <SchoolPicker labelledBy="ap-school" value={f.school_name} onChange={(v) => set('school_name', v)} />
        </div>
        <TextField label="Email" type="email" value={f.personal_email} onChange={(v) => set('personal_email', v)} hint="how they sign in, and where the claim link goes" />
        <div className="two-col two-col--code">
          <SelectBox label="Code" value={f.phone_country_code} options={COUNTRY_CODES} onChange={(v) => set('phone_country_code', v)} />
          <TextField label="Phone" type="tel" inputMode="tel" value={f.phone_number} onChange={(v) => set('phone_number', v.replace(/[^\d\s]/g, ''))} />
        </div>

        <h3 className="step-subhead">After Class 12</h3>
        <GapYearField value={gap} onChange={(p) => setGap((g) => ({ ...g, ...p }))} examOptions={exams.options} examAliases={exams.aliases} />
        {joinedNow && (
          <>
            <EntitySearchField
              kind="college" label="College" value={f.college}
              onChange={(v) => { set('college', v); setPick(null); }}
              onSelect={(hit) => { if (hit) { set('college', hit.name); setPick(toPick(hit)); } }}
            />
            <div className="two-col">
              <SelectBox label="Degree" value={f.degree} options={degreeOptions.filter((d) => d !== 'Other')} placeholder="—" onChange={(v) => set('degree', v)} />
              <OptionSearchField
                label="Branch" options={branches.options} aliases={branches.aliases} extra={contextualBranchAliases(f.degree)}
                value={f.branch} onChange={(v) => set('branch', v)}
              />
            </div>
          </>
        )}
        <SelectBox label="Area of study" value={f.field} options={CATEGORIES.map((c) => c.label)} placeholder="— worked out from the degree —" onChange={(v) => set('field', v)} />
        {named && (
          <AdmissionFields
            value={admission} onChange={(p) => setAdmission((a) => ({ ...a, ...p }))}
            examOptions={exams.options} examAliases={exams.aliases}
          />
        )}
        <ExamAttemptsField
          attempts={attempts} onChange={setAttempts}
          seatExam={named && admission.kind === 'entrance_exam' ? admission.exam : ''}
          area={areaKey} examOptions={exams.options} examAliases={exams.aliases}
          classOf={classOfNum} tookGap={gap.afterSchool === 'gap'}
          degreeOptions={degreeOptions} branchOptions={branches.options} branchAliases={branches.aliases}
          seatOffer={seatOffer}
          onSeatOffer={(patch) => setSeatOffer((o) => ({ ...(o ?? newOffer()), ...patch }))}
        />
        {named && (
          <AdmitsField
            admits={admits} onChange={setAdmits} open={showAdmits} onToggle={setShowAdmits}
            degreeOptions={degreeOptions}
            branchOptions={branches.options} branchAliases={branches.aliases}
            examOptions={exams.options} examAliases={exams.aliases}
          />
        )}

        <h3 className="step-subhead">Now</h3>
        <div className="two-col">
          <SelectBox label="Doing now" value={f.current_status} options={STATUSES.filter((s) => s !== 'Other')} placeholder="—" onChange={(v) => set('current_status', v)} />
          <TextField label="Currently at" value={f.currently_at} onChange={(v) => set('currently_at', v)} />
        </div>
        <LinkedInField value={linkedin} onChange={setLinkedin} />

        <h3 className="step-subhead">Family &amp; home 🔒</h3>
        <FamilyHomeFields
          value={family} onChange={(p) => setFamily((x) => ({ ...x, ...p }))}
          problems={familyErrors} touched={familyTouched}
          onTouch={(k) => setFamilyTouched((t) => ({ ...t, [k]: true }))}
          studentPhone={f.phone_number}
        />

        <h3 className="step-subhead">Office note</h3>
        <div className="field">
          <textarea
            value={officeNote} onChange={(e) => setOfficeNote(e.target.value)} maxLength={2000}
            placeholder="Only the school ever sees this — how you know them, what is still missing, who to call"
          />
        </div>

        <button type="button" className="btn btn--primary btn--block" disabled={saving} onClick={() => void save()} style={{ marginTop: 18 }}>
          <span className="btn__inner">{saving ? 'Saving…' : 'Save'}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Inviting them: a claim link by email, a WhatsApp message to send from the
 * office phone, or the link to copy. Never a password.
 */
function InvitePanel({ person }: { person: AlumniRow }) {
  const [busy, setBusy] = useState('');
  const [out, setOut] = useState<{ url: string; whatsapp: string; emailed: boolean | null; emailProblem: string | null } | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  if (person.user_id && person.consent_given !== false) return null;

  async function invite(channel: 'email' | 'whatsapp' | 'link') {
    setBusy(channel); setErr(''); setCopied(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setErr('Your session expired — sign in again.'); return; }
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ alumni_id: person.id, channel }),
      });
      const body = await res.json();
      if (!res.ok) { setErr(body.error ?? 'That did not work.'); return; }
      setOut(body);
      if (channel === 'whatsapp') window.open(body.whatsapp, '_blank', 'noopener');
    } catch {
      setErr('Could not reach the server.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="invite-panel">
      <p className="invite-panel__lead">
        <strong>Invite them to finish it.</strong> Each invitation is a fresh link that works once, for two weeks.
        Opening it lets them choose a password; nothing is public until they agree and you approve.
      </p>
      <div className="chips">
        <button type="button" className="btn btn--ghost" disabled={!!busy || !person.personal_email}
          title={person.personal_email ? undefined : 'No email on this profile'} onClick={() => void invite('email')}>
          <span className="btn__inner">{busy === 'email' ? 'Sending…' : '✉ Email the link'}</span>
        </button>
        <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => void invite('whatsapp')}>
          <span className="btn__inner">{busy === 'whatsapp' ? 'Preparing…' : 'WhatsApp message'}</span>
        </button>
        <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => void invite('link')}>
          <span className="btn__inner">{busy === 'link' ? 'Making…' : 'Copy a link'}</span>
        </button>
      </div>
      {err && <p className="field__error field__error--static">{err}</p>}
      {out && (
        <div className="invite-panel__out">
          {out.emailed === true && <p>✓ Emailed to {person.personal_email}.</p>}
          {out.emailed === false && <p className="field__error field__error--static">The email did not go ({out.emailProblem}). Send the link another way.</p>}
          <p style={{ wordBreak: 'break-all' }}><code>{out.url}</code></p>
          <div className="chips">
            <button type="button" className="btn btn--ghost" onClick={async () => {
              try { await navigator.clipboard.writeText(out.url); setCopied(true); } catch { /* shown above to copy by hand */ }
            }}>
              <span className="btn__inner">{copied ? '✓ Copied' : 'Copy'}</span>
            </button>
            <a className="btn btn--ghost" href={out.whatsapp} target="_blank" rel="noopener noreferrer">
              <span className="btn__inner">Open in WhatsApp</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
