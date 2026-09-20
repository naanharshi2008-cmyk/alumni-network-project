'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import {
  loadReview, logDecision, type AlumniRow, type HigherStudyRow, type PendingOption,
  type PendingPhoto, type ReviewData, type WorkExperienceRow,
} from '../adminData';
import { buildQueue, KIND_LABELS, waitedFor, type ReviewItem, type ReviewKind } from '../reviewModel';
import { splitStaged } from '../editFields';
import { useSearchParams } from 'next/navigation';
import { useAdminShell } from '../shell';
import AddAlumnus from '../AddAlumnus';
import ProfileReview from '../ProfileReview';
import { PendingOptionRow, existingValuesFor } from '../options';
import { UnmatchedEntityRow } from '../unmatched';
import { ConfirmAction, EmptyCard } from '../ui';

/**
 * Everything waiting for a decision, in one list, oldest first.
 *
 * Five kinds of thing used to sit in five tabs with five counts, so the oldest
 * item in the least-visited tab was the one nobody ever got to. They are one
 * queue now: the rail on the left is what is waiting, the pane on the right is
 * the whole of whatever is selected, and a decision moves you to the next one.
 */

const EMPTY: ReviewData = {
  pending: [], pendingEdits: [], photos: [], options: [], optionRows: [],
  approvedOptions: {}, unmatchedColleges: [], unmatchedCompanies: [],
  higherStudies: {}, workExperience: {}, error: '',
};

export default function ReviewPage() {
  const { refreshCounts, lastVisit } = useAdminShell();
  const [data, setData] = useState<ReviewData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Seeded from the URL, so a tile on the opening view can point at one kind
  // and so a filtered queue is a link somebody can send. useSearchParams is
  // safe here: the admin layout already wraps its children in a Suspense
  // boundary.
  const params = useSearchParams();
  const KINDS: ReviewKind[] = ['registration', 'edit', 'photo', 'option', 'unmatched'];
  const fromUrl = params.get('kind');
  const [filter, setFilter] = useState<ReviewKind | 'all'>(
    fromUrl && (KINDS as string[]).includes(fromUrl) ? (fromUrl as ReviewKind) : 'all',
  );
  const [cursor, setCursor] = useState(0);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [showKeys, setShowKeys] = useState(false);
  const [adding, setAdding] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const next = await loadReview();
    setData(next);
    if (next.error) setActionError('Could not load everything: ' + next.error);
    setLoading(false);
    refreshCounts();
  }, [refreshCounts]);

  useEffect(() => { void load(); }, [load]);

  const all = useMemo(() => buildQueue(data), [data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const i of all) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [all]);

  // Skipping sinks something for this sitting only; a reload brings it back in
  // its proper place, because "later" should not quietly become "never".
  const items = useMemo(() => {
    const list = filter === 'all' ? all : all.filter((i) => i.kind === filter);
    return [...list].sort((a, b) => Number(skipped.has(a.key)) - Number(skipped.has(b.key)));
  }, [all, filter, skipped]);

  const current = items[Math.min(cursor, Math.max(0, items.length - 1))];

  useEffect(() => { setCursor(0); }, [filter]);

  /** After a decision the item is gone, so the next one slides into its slot. */
  const advance = useCallback(() => {
    setCursor((c) => Math.max(0, Math.min(c, items.length - 2)));
  }, [items.length]);

  const move = useCallback((by: number) => {
    setCursor((c) => Math.max(0, Math.min(items.length - 1, c + by)));
  }, [items.length]);

  const newSinceLastVisit = useMemo(() => {
    if (!lastVisit) return 0;
    return data.pending.filter((p) => new Date(p.created_at).getTime() > lastVisit).length;
  }, [data.pending, lastVisit]);

  /* ── Decisions ─────────────────────────────────────────────────────────── */
  // Each one drops the item from local state rather than reloading the queue:
  // a reload would re-sort the list under the cursor mid-decision.
  function drop(key: string, patch: (d: ReviewData) => ReviewData) {
    setData(patch);
    setSkipped((s) => { const n = new Set(s); n.delete(key); return n; });
    advance();
    refreshCounts();
  }

  async function notifyApproved(ids: string[]) {
    if (!ids.length) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch('/api/admin/notify-approved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ ids }),
      });
    } catch { /* email is a courtesy; the approval already stands */ }
  }

  async function approveRegistration(person: AlumniRow) {
    setActionError(''); setBusy(true);
    // .select() is what turns "the statement ran" into "a row actually
    // changed": PostgREST answers success with zero rows whenever a row is
    // filtered out, so without it the dashboard would report an approval that
    // never happened and only a reload would give it away.
    const { data: hit, error } = await supabase.from('alumni')
      .update({ approval_status: 'approved', modification_status: 'none' })
      .eq('id', person.id).select('id');
    setBusy(false);
    if (error) { setActionError('Could not approve: ' + error.message); return; }
    if (!hit?.length) { setActionError('Nothing was approved — that profile may have been changed or removed. Reload and try again.'); return; }
    logDecision({
      kind: 'registration', subjectId: person.id, alumniId: person.id,
      action: 'approve', summary: person.full_name,
      before: { approval_status: person.approval_status, modification_status: person.modification_status },
      after: { approval_status: 'approved', modification_status: 'none' },
      undoable: true,
    });
    void notifyApproved([person.id]);
    setActionNote(`Approved ${person.full_name} — they're live on the directory now.`);
    drop(`registration:${person.id}`, (d) => ({ ...d, pending: d.pending.filter((p) => p.id !== person.id) }));
  }

  async function rejectRegistration(person: AlumniRow, reason: string) {
    setActionError(''); setBusy(true);
    const { data: hit, error } = await supabase.from('alumni')
      .update({ approval_status: 'rejected', rejection_reason: reason.trim() || null })
      .eq('id', person.id).select('id');
    setBusy(false);
    if (error) { setActionError('Could not reject: ' + error.message); return; }
    if (!hit?.length) { setActionError('Nothing was rejected — reload and try again.'); return; }
    logDecision({
      kind: 'registration', subjectId: person.id, alumniId: person.id,
      action: 'reject', summary: person.full_name, reason: reason.trim() || null,
      before: { approval_status: person.approval_status, rejection_reason: person.rejection_reason ?? null },
      after: { approval_status: 'rejected', rejection_reason: reason.trim() || null },
      undoable: true,
    });
    setActionNote(`Rejected ${person.full_name}.`);
    drop(`registration:${person.id}`, (d) => ({ ...d, pending: d.pending.filter((p) => p.id !== person.id) }));
  }

  async function deleteAlumnus(person: AlumniRow) {
    setActionError(''); setActionNote('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setActionError('Your session expired, please sign in again.'); return; }
    const res = await fetch('/api/admin/delete-alumni', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ id: person.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setActionError(body.error ?? 'Could not delete this profile.'); return; }
    // Not undoable, and the log says so: the row, the photo and the login are
    // all gone, and a log line claiming otherwise would be a lie in writing.
    logDecision({
      kind: 'profile', subjectId: person.id, alumniId: null,
      action: 'delete', summary: body.name ?? person.full_name, undoable: false,
    });
    setActionNote(
      `Deleted ${body.name ?? person.full_name}.` +
      (body.warnings?.length ? ` Note: ${body.warnings.join('; ')}.` : ''),
    );
    drop(`registration:${person.id}`, (d) => ({
      ...d,
      pending: d.pending.filter((p) => p.id !== person.id),
      pendingEdits: d.pendingEdits.filter((p) => p.id !== person.id),
    }));
  }

  /**
   * Publish the fields the school ticked, and only those.
   *
   * The whole of this used to live here: a spread of the staged blob into the
   * live columns, followed by a delete-and-reinsert of two timeline tables.
   * Three things were wrong with that. It was all-or-nothing, so one field
   * worth querying meant discarding the lot and asking the alumnus to type it
   * again. It was four statements with no transaction around them, and the
   * delete ran first - which is how a failed insert once destroyed somebody's
   * whole education and work history. And nothing recorded that it happened.
   *
   * admin_publish_changes does all of it in one statement, in the database,
   * inside one transaction, and writes the log line itself.
   */
  async function publishEdit(person: AlumniRow, keys: string[], studies: boolean, work: boolean, note: string) {
    setActionError(''); setBusy(true);
    const { data, error } = await supabase.rpc('admin_publish_changes', {
      p_alumni_id: person.id,
      p_keys: keys,
      p_studies: studies,
      p_work: work,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) { setActionError('Could not publish: ' + error.message); return; }
    const out = (data ?? {}) as {
      published?: string[]; refused?: string[]; studies?: boolean; work?: boolean; still_waiting?: boolean;
    };
    const n = (out.published?.length ?? 0) + (out.studies ? 1 : 0) + (out.work ? 1 : 0);

    setActionNote(
      `Published ${n} change${n === 1 ? '' : 's'} for ${person.full_name}.`
      + (out.refused?.length ? ` ${out.refused.length} value(s) the profile editor never sets were not published.` : '')
      + (out.still_waiting ? ' The rest is still waiting — they stay in the queue.' : ''),
    );

    if (out.still_waiting) {
      // Something is still staged, so they have not been decided. Re-read the
      // one row rather than the whole queue: a reload would re-sort the list
      // under the cursor mid-decision.
      const { data: fresh } = await supabase.from('alumni').select('*').eq('id', person.id).maybeSingle();
      if (fresh) {
        setData((d) => ({
          ...d,
          pendingEdits: d.pendingEdits.map((p) => (p.id === person.id ? (fresh as AlumniRow) : p)),
        }));
        refreshCounts();
        return;
      }
    }
    drop(`edit:${person.id}`, (d) => ({ ...d, pendingEdits: d.pendingEdits.filter((p) => p.id !== person.id) }));
  }

  async function discardEdit(person: AlumniRow, reason: string) {
    setActionError(''); setBusy(true);
    // The live columns were never touched, so discarding is just clearing the
    // staging area. The difference now is that the blob survives in the log,
    // so a discard is no longer the end of the only copy of what somebody
    // wrote - and the reason reaches them instead of nothing at all.
    const { error } = await supabase.rpc('admin_discard_changes', {
      p_alumni_id: person.id,
      p_keys: null,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) { setActionError('Could not discard the edits: ' + error.message); return; }
    setActionNote(`Discarded ${person.full_name}'s changes.`);
    drop(`edit:${person.id}`, (d) => ({ ...d, pendingEdits: d.pendingEdits.filter((p) => p.id !== person.id) }));
  }

  async function decidePhoto(photo: PendingPhoto, decision: 'approved' | 'rejected') {
    setActionError(''); setBusy(true);
    const { data: hit, error } = await supabase.from('college_photos')
      .update({ status: decision, reviewed_at: new Date().toISOString() })
      .eq('id', photo.id).select('id');
    setBusy(false);
    if (error || !hit?.length) {
      setActionError('Could not update that photo: ' + (error?.message ?? 'no row changed.'));
      return;
    }
    logDecision({
      kind: 'photo', subjectId: photo.id,
      action: decision === 'approved' ? 'approve' : 'reject',
      summary: `a campus photo of ${Array.isArray(photo.college) ? photo.college[0]?.name : photo.college?.name ?? 'a college'}`,
      before: { status: 'pending' }, after: { status: decision }, undoable: true,
    });
    setActionNote(decision === 'approved'
      ? 'Published — it is on the college page now.'
      : 'Hidden. The file stays until you delete it.');
    drop(`photo:${photo.id}`, (d) => ({ ...d, photos: d.photos.filter((p) => p.id !== photo.id) }));
  }

  async function deletePhoto(photo: PendingPhoto) {
    setActionError('');
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch('/api/college-photo', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(session.session ? { Authorization: `Bearer ${session.session.access_token}` } : {}),
      },
      body: JSON.stringify({ id: photo.id }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setActionError(out.error ?? 'Could not delete that photo.'); return; }
    logDecision({
      kind: 'photo', subjectId: photo.id, action: 'delete',
      summary: 'a campus photo, file and all', undoable: false,
    });
    setActionNote('Deleted, file and all.');
    drop(`photo:${photo.id}`, (d) => ({ ...d, photos: d.photos.filter((p) => p.id !== photo.id) }));
  }

  /* ── Keyboard ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable]')) return;
      if (!current) return;

      switch (e.key) {
        case 'j': case 'ArrowDown': e.preventDefault(); move(1); break;
        case 'k': case 'ArrowUp': e.preventDefault(); move(-1); break;
        case 's':
          e.preventDefault();
          setSkipped((prev) => new Set(prev).add(current.key));
          break;
        case 'a':
          if (busy) return;
          if (current.kind === 'registration') { e.preventDefault(); void approveRegistration(current.person); }
          else if (current.kind === 'edit') {
            // The keyboard publishes the lot, which is what the ticks start as
            // - anything less is a judgement the keyboard should not make.
            e.preventDefault();
            const staged = current.person.pending_changes ?? {};
            void publishEdit(
              current.person, Object.keys(splitStaged(staged).columns),
              Array.isArray(staged.higher_studies), Array.isArray(staged.work_experience), '',
            );
          }
          else if (current.kind === 'photo') { e.preventDefault(); void decidePhoto(current.photo, 'approved'); }
          // A value or an unmatched name has no single right answer - which
          // name? merge into what? - so the keyboard does not pretend it does.
          break;
        case '?': setShowKeys((v) => !v); break;
        case 'Escape': setShowKeys(false); break;
        default: break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keep the selected row in view when the keyboard moves the cursor.
  useEffect(() => {
    railRef.current?.querySelector('.queue__item--on')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, items.length]);

  if (loading) return <p className="subtitle">Loading what is waiting…</p>;

  const filters: { key: ReviewKind | 'all'; label: string }[] = [
    { key: 'all', label: 'Everything' },
    { key: 'registration', label: 'Registrations' },
    { key: 'edit', label: 'Edits' },
    { key: 'photo', label: 'Photos' },
    { key: 'option', label: 'Values' },
    { key: 'unmatched', label: 'Names' },
  ];

  return (
    <>
      {newSinceLastVisit > 0 && (
        <div className="alert alert--success" style={{ marginBottom: 16 }}>
          <strong>{newSinceLastVisit}</strong> new registration{newSinceLastVisit === 1 ? '' : 's'} since you last opened this dashboard.
        </div>
      )}

      <div className="queue__bar">
        <div className="chips" style={{ margin: 0 }}>
          {filters.map((f) => (
            <button
              key={f.key} type="button"
              className={`chip${filter === f.key ? ' chip--active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span style={{ opacity: 0.7, marginLeft: 6 }}>{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="queue__bar-right">
          <button type="button" className="btn btn--ghost" onClick={() => setAdding((v) => !v)}>
            <span className="btn__inner">＋ Add an alumnus</span>
          </button>
          <button type="button" className="link-btn" onClick={() => setShowKeys((v) => !v)} aria-expanded={showKeys}>
            Keyboard
          </button>
        </div>
      </div>

      {showKeys && (
        <div className="card queue__keys">
          <p><span className="kbd">j</span> <span className="kbd">k</span> move through the list</p>
          <p><span className="kbd">a</span> approve, publish or accept the one in front of you</p>
          <p><span className="kbd">s</span> skip it for now — it comes back next time you load</p>
          <p><span className="kbd">?</span> show or hide this</p>
          <p className="hint" style={{ display: 'block', marginTop: 8 }}>
            Values and unmatched names ask a question rather than offering a yes, so
            <span className="kbd" style={{ margin: '0 4px' }}>a</span> does nothing there.
          </p>
        </div>
      )}

      {adding && <AddAlumnus onAdded={() => { setAdding(false); void load(); }} setError={setActionError} />}

      {actionError && <div className="alert alert--error">{actionError}</div>}
      {actionNote && <div className="alert alert--success">{actionNote}</div>}

      {items.length === 0 ? (
        <EmptyCard emoji="🎉" text={filter === 'all' ? 'Nothing is waiting. All caught up.' : 'Nothing of this kind is waiting.'} />
      ) : (
        <div className="queue">
          <div className="queue__rail" ref={railRef}>
            <p className="queue__progress">
              {Math.min(cursor + 1, items.length)} of {items.length}
            </p>
            {items.map((item, i) => (
              <button
                key={item.key} type="button"
                className={`queue__item${i === cursor ? ' queue__item--on' : ''}${skipped.has(item.key) ? ' queue__item--skipped' : ''}`}
                onClick={() => setCursor(i)}
              >
                <span className="queue__kind">{KIND_LABELS[item.kind]}</span>
                <span className="queue__title">{item.title}</span>
                <span className="queue__summary">{item.summary}</span>
                <span className="queue__age">waiting {waitedFor(item.waitingSince)}</span>
              </button>
            ))}
          </div>

          <div className="queue__detail">
            {current && (
              <Detail
                item={current}
                data={data}
                busy={busy}
                onApproveRegistration={approveRegistration}
                onRejectRegistration={rejectRegistration}
                onDeleteAlumnus={deleteAlumnus}
                onPublishEdit={publishEdit}
                onDiscardEdit={discardEdit}
                onDecidePhoto={decidePhoto}
                onDeletePhoto={deletePhoto}
                onSkip={() => setSkipped((prev) => new Set(prev).add(current.key))}
                onResolvedOption={(id) => drop(`option:${id}`, (d) => ({ ...d, options: d.options.filter((o) => o.id !== id) }))}
                onResolvedGroup={(item) => drop(item.key, (d) => ({
                  ...d,
                  unmatchedColleges: item.kind === 'unmatched' && item.entity === 'colleges'
                    ? d.unmatchedColleges.filter((g) => g.key !== item.group.key) : d.unmatchedColleges,
                  unmatchedCompanies: item.kind === 'unmatched' && item.entity === 'organizations'
                    ? d.unmatchedCompanies.filter((g) => g.key !== item.group.key) : d.unmatchedCompanies,
                }))}
                setError={setActionError}
                studies={data.higherStudies}
                work={data.workExperience}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * One person, and what the school decides about them.
 *
 * Its own component because publishing is no longer one button: the ticks and
 * the note are state, and state belongs to something that remounts when the
 * queue moves to the next person. Keyed on the person's id below, so nobody
 * ever publishes the previous card's ticks.
 */
function PersonDetail({
  item, busy, studies, work, skip,
  onApproveRegistration, onRejectRegistration, onDeleteAlumnus, onPublishEdit, onDiscardEdit,
}: {
  item: Extract<ReviewItem, { kind: 'registration' | 'edit' }>;
  busy: boolean;
  studies: Record<string, HigherStudyRow[]>;
  work: Record<string, WorkExperienceRow[]>;
  skip: React.ReactNode;
  onApproveRegistration: (p: AlumniRow) => Promise<void>;
  onRejectRegistration: (p: AlumniRow, reason: string) => Promise<void>;
  onPublishEdit: (p: AlumniRow, keys: string[], studies: boolean, work: boolean, note: string) => Promise<void>;
  onDiscardEdit: (p: AlumniRow, reason: string) => Promise<void>;
  onDeleteAlumnus: (p: AlumniRow) => Promise<void>;
}) {
  const person = item.person;
  const staged = item.kind === 'edit' ? person.pending_changes : null;

  // Everything publishable starts ticked, so the common case - publish the
  // lot - is still one click. Unticking is the deliberate act.
  const publishable = useMemo(() => {
    const { columns } = splitStaged(staged);
    const keys = Object.keys(columns);
    if (Array.isArray(staged?.higher_studies)) keys.push('higher_studies');
    if (Array.isArray(staged?.work_experience)) keys.push('work_experience');
    return keys;
  }, [staged]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(publishable));
  const [note, setNote] = useState('');

  const picks = item.kind === 'edit' ? {
    has: (k: string) => picked.has(k),
    toggle: (k: string) => setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    }),
  } : null;

  const chosen = publishable.filter((k) => picked.has(k));
  const held = publishable.length - chosen.length;
  const columnKeys = chosen.filter((k) => k !== 'higher_studies' && k !== 'work_experience');

  return (
    <div className="card">
      <ProfileReview
        person={person}
        studies={studies[person.id]}
        work={work[person.id]}
        staged={staged}
        picks={picks}
      />

      {item.kind === 'edit' && held > 0 && (
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="review-note">
            What to tell them about the {held} change{held === 1 ? '' : 's'} you are holding back
            <span className="opt">optional — they see this on their profile</span>
          </label>
          <textarea
            id="review-note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. “We’ll add the college once we can confirm the name.”"
            style={{ minHeight: 56 }}
          />
        </div>
      )}

      <div className="queue__actions">
        {item.kind === 'registration' ? (
          <>
            <button type="button" className="btn btn--primary" disabled={busy}
              onClick={() => onApproveRegistration(person)}>
              <span className="btn__inner">✓ Approve</span>
            </button>
            <ConfirmAction
              label="✕ Reject" confirmLabel="Yes, reject" busyLabel="Rejecting…" wide
              question={<>Reject <strong>{person.full_name}</strong>? They stay out of the directory.</>}
              reason={{ placeholder: 'Reason (optional, for your records)' }}
              onConfirm={(why) => onRejectRegistration(person, why)}
            />
            {skip}
            <span style={{ marginLeft: 'auto' }}>
              <ConfirmAction
                label="🗑 Delete" confirmLabel="Yes, delete permanently" busyLabel="Deleting…" wide
                question={<>Permanently delete <strong>{person.full_name}</strong>? Their profile, photo and login are removed. This cannot be undone.</>}
                onConfirm={() => onDeleteAlumnus(person)}
              />
            </span>
          </>
        ) : (
          <>
            <button
              type="button" className="btn btn--primary"
              disabled={busy || chosen.length === 0}
              onClick={() => onPublishEdit(
                person, columnKeys,
                picked.has('higher_studies'), picked.has('work_experience'), note,
              )}
            >
              <span className="btn__inner">
                {held === 0
                  ? '✓ Publish changes'
                  : `✓ Publish ${chosen.length} of ${publishable.length}`}
              </span>
            </button>
            <ConfirmAction
              label="↩ Discard changes" confirmLabel="Yes, discard them" busyLabel="Discarding…" wide
              question={`Discard everything ${person.full_name} submitted? What they wrote is kept in the review log, so this can be looked up - but it leaves their profile.`}
              reason={{ placeholder: 'Why — they see this on their profile' }}
              onConfirm={(why) => onDiscardEdit(person, why)}
            />
            {skip}
            {held > 0 && (
              <span className="queue__held">
                {held} change{held === 1 ? '' : 's'} stay{held === 1 ? 's' : ''} in the queue.
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Detail({
  item, data, busy, studies, work,
  onApproveRegistration, onRejectRegistration, onDeleteAlumnus,
  onPublishEdit, onDiscardEdit, onDecidePhoto, onDeletePhoto,
  onSkip, onResolvedOption, onResolvedGroup, setError,
}: {
  item: ReviewItem;
  data: ReviewData;
  busy: boolean;
  studies: Record<string, HigherStudyRow[]>;
  work: Record<string, WorkExperienceRow[]>;
  onApproveRegistration: (p: AlumniRow) => Promise<void>;
  onRejectRegistration: (p: AlumniRow, reason: string) => Promise<void>;
  onDeleteAlumnus: (p: AlumniRow) => Promise<void>;
  onPublishEdit: (p: AlumniRow, keys: string[], studies: boolean, work: boolean, note: string) => Promise<void>;
  onDiscardEdit: (p: AlumniRow, reason: string) => Promise<void>;
  onDecidePhoto: (p: PendingPhoto, d: 'approved' | 'rejected') => Promise<void>;
  onDeletePhoto: (p: PendingPhoto) => Promise<void>;
  onSkip: () => void;
  onResolvedOption: (id: number) => void;
  onResolvedGroup: (item: ReviewItem) => void;
  setError: (m: string) => void;
}) {
  const skip = (
    <button type="button" className="btn btn--ghost" onClick={onSkip}>
      <span className="btn__inner">Skip for now</span>
    </button>
  );

  if (item.kind === 'registration' || item.kind === 'edit') {
    return (
      <PersonDetail
        // Keyed, so the ticks and the note belong to this person and nobody
        // ever publishes the previous card's choices.
        key={item.person.id}
        item={item} busy={busy} studies={studies} work={work}
        onApproveRegistration={onApproveRegistration}
        onRejectRegistration={onRejectRegistration}
        onDeleteAlumnus={onDeleteAlumnus}
        onPublishEdit={onPublishEdit}
        onDiscardEdit={onDiscardEdit}
        skip={skip}
      />
    );
  }


  if (item.kind === 'photo') {
    const photo = item.photo;
    const college = Array.isArray(photo.college) ? photo.college[0] : photo.college;
    const who = Array.isArray(photo.alumni) ? photo.alumni[0] : photo.alumni;
    return (
      <div className="card">
        <img
          src={photo.url} alt={photo.caption ?? ''} loading="lazy"
          style={{ width: '100%', maxHeight: 340, objectFit: 'cover', borderRadius: 'var(--r-sm)', marginBottom: 12 }}
        />
        <strong>{college?.name ?? 'Unknown college'}</strong>
        <p className="subtitle" style={{ margin: '4px 0 10px', fontSize: '0.86rem' }}>
          {photo.caption || <em>No caption</em>}
          {who ? ` — shared by ${who.full_name}${who.class_of ? `, class of ${who.class_of}` : ''}` : ''}
        </p>
        <div className="queue__actions">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onDecidePhoto(photo, 'approved')}>
            <span className="btn__inner">✓ Publish</span>
          </button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onDecidePhoto(photo, 'rejected')}>
            <span className="btn__inner">Hide</span>
          </button>
          {skip}
          <span style={{ marginLeft: 'auto' }}>
            <ConfirmAction
              label="🗑 Delete" confirmLabel="Yes, delete it" busyLabel="Deleting…" wide
              question="Delete this photo and its file? This cannot be undone."
              onConfirm={() => onDeletePhoto(photo)}
            />
          </span>
        </div>
      </div>
    );
  }

  if (item.kind === 'option') {
    return (
      <div className="card">
        <p className="subtitle" style={{ margin: '0 0 12px', fontSize: '0.88rem' }}>
          Somebody typed this under &ldquo;Other&rdquo;. It already shows on their own profile —
          approving is what adds it to the dropdown everyone else picks from. Merge it into an
          existing name instead when it means the same thing.
        </p>
        <PendingOptionRow
          option={item.option as PendingOption}
          existing={existingValuesFor(item.option.category, data.approvedOptions)}
          onResolved={onResolvedOption}
          onApprovedValue={() => {}}
          setError={setError}
        />
        <div className="queue__actions">{skip}</div>
      </div>
    );
  }

  return (
    <div className="card">
      <p className="subtitle" style={{ margin: '0 0 12px', fontSize: '0.88rem' }}>
        {item.entity === 'colleges'
          ? 'Somebody typed a college name that matched nothing on our list — usually just a spelling difference. Link it once and everyone who typed it is linked too.'
          : 'Somebody typed an employer that is not on our list yet. Link it once and everyone who typed it is linked too.'}
      </p>
      <UnmatchedEntityRow
        kind={item.entity}
        groupKey={item.group.key}
        display={item.group.display}
        alumniIds={item.group.alumniIds}
        onResolved={() => onResolvedGroup(item)}
      />
      <div className="queue__actions">{skip}</div>
    </div>
  );
}
