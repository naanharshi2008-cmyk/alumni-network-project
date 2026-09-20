'use client';

/**
 * The institutes bench: one college's public face (banner, logo, description),
 * the school's private note about each student there, and the names an
 * institute is known by - rename, alias, merge.
 *
 * Moved out of the admin page unchanged when the dashboard was split into
 * Review / People / Data. It belongs to Data.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import EntitySearchField, { type EntityHit } from '../../lib/EntitySearchField';
import { instKey } from '../../lib/instituteKey';
import { officialSchoolName } from '../../lib/options';
import type { AliasRow, CollegeInfoRow } from './adminData';
import { ConfirmAction } from './ui';

/**
 * One college in the "Colleges" tab: banner upload/replace/remove, the
 * admin-written description, and per-student "Note from Veveaham" fields.
 *
 * Banner and description go through the service-role API route - the only
 * writer for those columns. The per-student note writes directly: the admin
 * RLS policy on alumni covers it, and a plain single-column update cannot
 * disturb the staged-edits flow.
 */
export function CollegeInfoCard({
  college, onChanged, onNoteSaved, onError, onNote, onMerged, initialAliases, open, onToggle,
}: {
  college: CollegeInfoRow;
  /** Fetched with the college list, so each card does not query for its own. */
  initialAliases?: AliasRow[];
  /**
   * One card is open at a time. Closed cards render their header and nothing
   * else: eighteen colleges meant eighteen textareas and thirty-six file
   * inputs in the page at once, and a scroll long enough that finding the one
   * missing a logo was the work rather than fixing it.
   */
  open: boolean;
  onToggle: () => void;
  onChanged: (patch: Partial<CollegeInfoRow>) => void;
  onNoteSaved: (studentId: string, note: string | null) => void;
  onError: (msg: string) => void;
  onNote: (msg: string) => void;
  onMerged: () => void;
}) {
  const [description, setDescription] = useState(college.description ?? '');
  const [busy, setBusy] = useState(false);
  const [showStudents, setShowStudents] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  async function authed(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { onError('Your session expired, please sign in again.'); return null; }
    return session.access_token;
  }

  // Downscale before upload: banners never need more than ~1600px, and the
  // route (and Vercel itself) cap the body at 4MB.
  async function shrink(file: File): Promise<Blob> {
    if (file.size < 1.5 * 1024 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / bmp.width);
      if (scale === 1) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
      return blob ?? file;
    } catch {
      return file; // downscaling is an optimisation, never a gate
    }
  }

  async function upload(file: File, kind: 'banner' | 'logo' = 'banner') {
    if (!file.type.startsWith('image/')) { onError('Banners must be JPG, PNG or WEBP images.'); return; }
    const token = await authed();
    if (!token) return;
    setBusy(true);
    try {
      const body = await shrink(file);
      if (body.size > 4 * 1024 * 1024) {
        onError('That image is over 4MB even after shrinking — please use a smaller one.');
        return;
      }
      const form = new FormData();
      form.set('college_id', college.id);
      form.set('kind', kind);
      form.set('file', body, file.name.replace(/\.[^.]+$/, '') + (body.type === 'image/jpeg' ? '.jpg' : ''));
      const res = await fetch('/api/admin/college-banner', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { onError(out.error ?? 'Upload failed.'); return; }
      onChanged(kind === 'logo' ? { logo_url: out.logo_url } : { banner_url: out.banner_url });
      onNote(`${kind === 'logo' ? 'Logo' : 'Banner'} saved for ${college.name}.${out.warnings?.length ? ` Note: ${out.warnings.join('; ')}` : ''}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeBanner(kind: 'banner' | 'logo' = 'banner') {
    const token = await authed();
    if (!token) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/college-banner', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ college_id: college.id, kind }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { onError(out.error ?? `Could not remove the ${kind}.`); return; }
      onChanged(kind === 'logo' ? { logo_url: null } : { banner_url: null });
      onNote(`${kind === 'logo' ? 'Logo' : 'Banner'} removed for ${college.name}.`);
    } finally {
      setBusy(false);
    }
  }

  async function saveDescription() {
    const token = await authed();
    if (!token) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('college_id', college.id);
      form.set('description', description);
      const res = await fetch('/api/admin/college-banner', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { onError(out.error ?? 'Could not save the description.'); return; }
      onChanged({ description: description.trim() || null });
      onNote(`Description saved for ${college.name}.`);
    } finally {
      setBusy(false);
    }
  }

  const gaps = collegeGaps(college);

  return (
    <div className={`card inst-card${open ? ' inst-card--open' : ''}`} style={{ marginBottom: 14, padding: '14px 18px' }}>
      <h3 style={{ margin: 0, fontSize: '1.02rem' }}>
        <button type="button" className="inst-card__head" aria-expanded={open} onClick={onToggle}>
          <span className="inst-card__name">{college.name.split(',')[0]}</span>
          <span className="subtitle inst-card__where">
            {[college.district, college.state].filter(Boolean).join(', ') || '—'}
            {' · '}{college.students.length} {college.students.length === 1 ? 'student' : 'students'}
            {/* A college whose students are all still waiting used to be
                missing from this bench entirely, which is the one time the
                imagery most wants doing: it should be ready the moment the
                school approves them. */}
            {college.students_pending > 0 && <> · {college.students_pending} waiting</>}
            {college.photos_pending > 0 && <> · {college.photos_pending} photo{college.photos_pending === 1 ? '' : 's'} to review</>}
          </span>
          {/* Three dots, in the order a college page shows them. Cheaper to
              scan down a column of eighteen than any wording would be. */}
          <span className="inst-dots" aria-hidden>
            <i className={college.banner_url ? 'on' : ''} title="Banner" />
            <i className={college.logo_url ? 'on' : ''} title="Logo" />
            <i className={college.description?.trim() ? 'on' : ''} title="Description" />
          </span>
          <span className={`inst-card__gaps${gaps.length ? '' : ' inst-card__gaps--done'}`}>
            {gaps.length ? `needs ${gaps.join(', ')}` : 'complete'}
          </span>
          <span className="inst-card__chev" aria-hidden>{open ? '▲' : '▼'}</span>
        </button>
      </h3>

      {!open ? null : (
      <>
      <InstituteNamesEditor
        kind="college"
        id={college.id}
        name={college.name}
        initialAliases={initialAliases}
        onRenamed={(name) => onChanged({ name })}
        onMerged={onMerged}
        onError={onError}
        onNote={onNote}
      />

      {college.banner_url
        ? <img src={college.banner_url} alt="" style={{ width: '100%', height: 84, objectFit: 'cover', borderRadius: 'var(--r-sm)', margin: '12px 0 10px' }} loading="lazy" />
        : <p className="subtitle" style={{ fontSize: '0.82rem', margin: '12px 0 10px' }}>No banner yet.</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          style={{ fontSize: '0.82rem' }}
        />
        {college.banner_url && (
          <ConfirmAction
            label="🗑 Remove banner"
            confirmLabel="Yes, remove it"
            busyLabel="Removing…"
            question={`Remove the banner for ${college.name.split(',')[0]}? The image disappears from every page that shows it.`}
            onConfirm={() => removeBanner('banner')}
            className="btn btn--ghost"
          />
        )}
      </div>

      {/* The logo sits on top of the banner on the college pages. */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <span className="subtitle" style={{ fontSize: '0.82rem' }}>Logo:</span>
        {college.logo_url
          ? <img src={college.logo_url} alt="" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 8, background: '#fbf6ec', padding: 3 }} loading="lazy" />
          : <span className="subtitle" style={{ fontSize: '0.82rem' }}>none yet</span>}
        <input
          ref={logoRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, 'logo'); }}
          style={{ fontSize: '0.82rem' }}
        />
        {college.logo_url && (
          <ConfirmAction
            label="🗑 Remove logo"
            confirmLabel="Yes, remove it"
            busyLabel="Removing…"
            question={`Remove the logo for ${college.name.split(',')[0]}?`}
            onConfirm={() => removeBanner('logo')}
            className="btn btn--ghost"
          />
        )}
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>About this college <span className="opt">shown publicly</span></label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A line or two about the college — what it's known for, campus, placements…"
        />
        <button type="button" className="btn btn--neutral" disabled={busy} onClick={saveDescription} style={{ marginTop: 8 }}>
          <span className="btn__inner">{busy ? 'Saving…' : 'Save description'}</span>
        </button>
      </div>

      <button
        type="button"
        className="btn btn--plain btn--plain-neutral"
        style={{ width: '100%', marginTop: 12 }}
        onClick={() => setShowStudents((v) => !v)}
      >
        {showStudents ? '▲ Hide students' : `▼ Notes for ${college.students.length} student(s) here`}
      </button>

      {showStudents && college.students.map((st) => (
        <StudentNoteRow key={st.id} student={st} onSaved={onNoteSaved} onError={onError} onNote={onNote} />
      ))}
      </>
      )}
    </div>
  );
}

/** What this college is still missing, in the order a college page shows it. */
export function collegeGaps(college: CollegeInfoRow): string[] {
  const gaps: string[] = [];
  if (!college.banner_url) gaps.push('banner');
  if (!college.logo_url) gaps.push('logo');
  if (!college.description?.trim()) gaps.push('description');
  return gaps;
}

/** One student's "Note from Veveaham" — a direct admin write to alumni.school_note. */
export function StudentNoteRow({
  student, onSaved, onError, onNote,
}: {
  student: { id: string; full_name: string; class_of: number | null; school_note: string | null; pending?: boolean };
  onSaved: (id: string, note: string | null) => void;
  onError: (msg: string) => void;
  onNote: (msg: string) => void;
}) {
  const [note, setNote] = useState(student.school_note ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const clean = note.trim() || null;
      const { data, error } = await supabase
        .from('alumni')
        .update({ school_note: clean })
        .eq('id', student.id)
        .select('id');
      if (error) { onError(`Could not save the note: ${error.message}`); return; }
      if (!data || data.length === 0) { onError('The note did not save — please try again.'); return; }
      onSaved(student.id, clean);
      onNote(`Note saved for ${student.full_name}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px', marginTop: 10 }}>
      <p style={{ margin: '0 0 6px', fontSize: '0.88rem', fontWeight: 650 }}>
        {student.full_name} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· Class of {student.class_of ?? '—'}</span>
        {student.pending && <span className="badge badge--sm" style={{ marginLeft: 6 }}>not approved yet</span>}
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="A proud line about them, in the school's voice — shown on their public profile."
        style={{ minHeight: 56 }}
      />
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={save} style={{ marginTop: 6 }}>
        <span className="btn__inner">{busy ? 'Saving…' : 'Save note'}</span>
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Institute names: the display name, the other names people type, and merging
   duplicates. All writes go through migration 10's admin functions or the
   aliases table (admin-only by row-level security).
───────────────────────────────────────────────────────────────────────── */
export function InstituteNamesEditor({
  kind, id, name, onRenamed, onMerged, onError, onNote, initialAliases,
}: {
  kind: 'college' | 'organization';
  id: string;
  name: string;
  onRenamed: (name: string) => void;
  onMerged: () => void;
  onError: (msg: string) => void;
  onNote: (msg: string) => void;
  /** Already fetched with the college list; saves a query per card. */
  initialAliases?: AliasRow[];
}) {
  const [aliases, setAliases] = useState<AliasRow[] | null>(initialAliases ?? null);
  const [nameDraft, setNameDraft] = useState(name);
  const [aliasDraft, setAliasDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<EntityHit | null>(null);
  const [dupText, setDupText] = useState('');
  const [confirmMerge, setConfirmMerge] = useState(false);
  const fk = kind === 'college' ? 'college_id' : 'organization_id';

  const loadAliases = useCallback(async () => {
    const { data, error } = await supabase.from('institute_aliases').select('id, alias, source').eq(fk, id).order('alias');
    if (error) { onError('Could not load the other names: ' + error.message); return; }
    setAliases((data as AliasRow[]) ?? []);
  }, [fk, id, onError]);

  useEffect(() => { if (!initialAliases) void loadAliases(); }, [initialAliases, loadAliases]);
  useEffect(() => { setNameDraft(name); }, [name]);

  async function rename() {
    const next = nameDraft.trim();
    if (!next || next === name) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_rename_institute', { p_kind: kind, p_id: id, p_name: next });
    setBusy(false);
    if (error) { onError(error.message); return; }
    onRenamed(next);
    onNote(`Renamed to “${next}”. The old name still finds it.`);
    void loadAliases();
  }

  async function addAlias() {
    const alias = aliasDraft.trim();
    if (!alias) return;
    if (instKey(alias) === instKey(name)) { onError('That is already its name.'); return; }
    if (instKey(alias).length < 2) { onError('That is too short to be a useful name.'); return; }
    setBusy(true);
    const { error } = await supabase.from('institute_aliases').insert({ [fk]: id, alias, source: 'admin' });
    setBusy(false);
    if (error) {
      onError(error.code === '23505' ? `“${alias}” is already listed for it.` : 'Could not add that name: ' + error.message);
      return;
    }
    setAliasDraft('');
    void loadAliases();
  }

  async function removeAlias(row: AliasRow) {
    setBusy(true);
    const { data, error } = await supabase.from('institute_aliases').delete().eq('id', row.id).select('id');
    setBusy(false);
    if (error || !data?.length) { onError('Could not remove that name.'); return; }
    setAliases((prev) => (prev ?? []).filter((a) => a.id !== row.id));
  }

  async function merge() {
    if (!dup) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('merge_institute', { p_kind: kind, p_from: dup.id, p_into: id });
    setBusy(false);
    setConfirmMerge(false);
    if (error) { onError(error.message); return; }
    const moved = (data as { moved_alumni?: number } | null)?.moved_alumni ?? 0;
    onNote(`Merged “${dup.name}” into “${name}”. ${moved} profile${moved === 1 ? '' : 's'} moved; its old name still finds this one.`);
    setDup(null); setDupText('');
    void loadAliases();
    onMerged();
  }

  return (
    <div className="inst-names">
      <div className="inst-names__row">
        <input
          type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
          aria-label="Display name" disabled={busy}
        />
        <button type="button" className="btn btn--ghost" disabled={busy || !nameDraft.trim() || nameDraft.trim() === name} onClick={rename}>
          <span className="btn__inner">Rename</span>
        </button>
      </div>

      <p className="inst-names__label">Also known as</p>
      <div className="inst-names__chips">
        {aliases === null && <span className="hint">loading…</span>}
        {aliases?.length === 0 && <span className="hint">no other names yet</span>}
        {aliases?.map((a) => (
          <span key={a.id} className="alias-chip" title={`added: ${a.source}`}>
            {a.alias}
            <button type="button" aria-label={`Remove ${a.alias}`} disabled={busy} onClick={() => removeAlias(a)}>×</button>
          </span>
        ))}
      </div>
      <div className="inst-names__row">
        <input
          type="text" value={aliasDraft} placeholder="Add a name people type, e.g. NIT Trichy"
          onChange={(e) => setAliasDraft(e.target.value)} disabled={busy}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addAlias(); } }}
          aria-label="Add another name"
        />
        <button type="button" className="btn btn--ghost" disabled={busy || !aliasDraft.trim()} onClick={addAlias}>
          <span className="btn__inner">Add</span>
        </button>
      </div>

      <details className="inst-names__merge">
        <summary>Merge a duplicate into this one</summary>
        <EntitySearchField
          kind={kind} label="Find the duplicate" hint="its alumni, aliases and old name move here"
          value={dupText} onChange={setDupText}
          onSelect={(hit) => { setDup(hit && hit.id !== id ? hit : null); setConfirmMerge(false); }}
        />
        {dup && !confirmMerge && (
          <button type="button" className="btn btn--neutral" style={{ marginTop: 8 }} onClick={() => setConfirmMerge(true)}>
            <span className="btn__inner">Merge “{dup.name}” into this…</span>
          </button>
        )}
        {dup && confirmMerge && (
          <div className="delete-confirm" style={{ marginTop: 8 }}>
            <p style={{ margin: '0 0 10px' }}>
              Merge <strong>{dup.name}</strong> into <strong>{name}</strong>? Its profiles and other names
              move here and it disappears from search. This cannot be undone from the dashboard.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn--neutral" disabled={busy} onClick={merge}>
                <span className="btn__inner">{busy ? 'Merging…' : 'Yes, merge'}</span>
              </button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirmMerge(false)}>
                <span className="btn__inner">Cancel</span>
              </button>
            </div>
          </div>
        )}
      </details>
    </div>
  );
}

/** Open any college or company for name editing, including ones no alumnus has yet. */
export function FindInstitute({ onError, onNote, onMerged }: {
  onError: (msg: string) => void;
  onNote: (msg: string) => void;
  onMerged: () => void;
}) {
  const [kind, setKind] = useState<'college' | 'organization'>('college');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<EntityHit | null>(null);

  return (
    <div className="card" style={{ marginBottom: 18, padding: '16px 20px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {(['college', 'organization'] as const).map((k) => (
          <button key={k} type="button" className={`chip${kind === k ? ' chip--active' : ''}`}
            onClick={() => { setKind(k); setPicked(null); setText(''); }}>
            {k === 'college' ? 'Colleges' : 'Companies & organisations'}
          </button>
        ))}
      </div>
      <EntitySearchField
        kind={kind} label={kind === 'college' ? 'Find any college' : 'Find any organisation'}
        hint="to rename it, add other names, or merge a duplicate"
        value={text} onChange={setText} onSelect={setPicked}
      />
      {picked && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 700 }}>{picked.name}</p>
          <InstituteNamesEditor
            kind={kind}
            id={picked.id}
            name={picked.name}
            onRenamed={(name) => { setPicked({ ...picked, name }); setText(name); }}
            onMerged={onMerged}
            onError={onError}
            onNote={onNote}
          />
        </div>
      )}
    </div>
  );
}
