'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import {
  loadReview, type AlumniRow, type HigherStudyRow, type PendingOption,
  type PendingPhoto, type ReviewData, type WorkExperienceRow,
} from '../adminData';
import { buildQueue, KIND_LABELS, waitedFor, type ReviewItem, type ReviewKind } from '../reviewModel';
import { splitStaged } from '../editFields';
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

  const [filter, setFilter] = useState<ReviewKind | 'all'>('all');
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

  async function publishEdit(person: AlumniRow) {
    setActionError(''); setBusy(true);
    const staged = person.pending_changes;
    if (!staged) { setBusy(false); setActionError('Nothing staged for this person.'); return; }

    // Only the fields the profile editor can set. The blob is written by the
    // alumnus and this update runs as the school, so spreading it whole
    // published anything they cared to put in it - see editFields.ts.
    const { higher_studies, work_experience } = staged;
    const { columns, unknown } = splitStaged(staged);

    const { data: published, error } = await supabase.from('alumni')
      // last_updated sits AFTER the spread on purpose: publishing is the
      // moment the public content changes, so publish time always wins.
      .update({ ...columns, modification_status: 'none', pending_changes: null, last_updated: new Date().toISOString() })
      .eq('id', person.id).select('id');
    if (error) { setBusy(false); setActionError('Could not publish: ' + error.message); return; }
    if (!published?.length) { setBusy(false); setActionError('Nothing was published — reload and try again.'); return; }

    // Timelines are stored whole, so replace rather than merge. Both errors are
    // checked: the delete runs first, so a failed insert once destroyed a
    // person's entire education and work history while the card still
    // disappeared as though it had worked.
    for (const [table, rowsRaw] of [
      ['higher_studies', higher_studies],
      ['work_experience', work_experience],
    ] as const) {
      if (!Array.isArray(rowsRaw)) continue;
      const { error: delErr } = await supabase.from(table).delete().eq('alumni_id', person.id);
      if (delErr) {
        setBusy(false);
        setActionError(`Published the profile details, but could not update ${table.replace('_', ' ')}: ${delErr.message}`);
        return;
      }
      if (rowsRaw.length) {
        const { error: insErr } = await supabase.from(table).insert(
          rowsRaw.map((r: any) => ({ ...r, alumni_id: person.id })),
        );
        if (insErr) {
          setBusy(false);
          setActionError(
            `Published the profile details, but their ${table.replace('_', ' ')} entries did not save (${insErr.message}). ` +
            'Ask them to re-enter that section from their profile page.',
          );
          return;
        }
      }
    }
    setBusy(false);
    setActionNote(
      `Published ${person.full_name}'s changes — the directory shows them now.` +
      (unknown.length ? ` ${unknown.length} unrecognised value(s) were not published.` : ''),
    );
    drop(`edit:${person.id}`, (d) => ({ ...d, pendingEdits: d.pendingEdits.filter((p) => p.id !== person.id) }));
  }

  async function discardEdit(person: AlumniRow) {
    setActionError(''); setBusy(true);
    // The live columns were never touched, so discarding is just clearing the
    // staging area - no restore step and nothing for the public to notice.
    const { data: hit, error } = await supabase.from('alumni')
      .update({ modification_status: 'rejected', pending_changes: null })
      .eq('id', person.id).select('id');
    setBusy(false);
    if (error) { setActionError('Could not discard the edits: ' + error.message); return; }
    if (!hit?.length) { setActionError('Nothing was discarded — reload and try again.'); return; }
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
          else if (current.kind === 'edit') { e.preventDefault(); void publishEdit(current.person); }
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
  onPublishEdit: (p: AlumniRow) => Promise<void>;
  onDiscardEdit: (p: AlumniRow) => Promise<void>;
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
    const person = item.person;
    return (
      <div className="card">
        <ProfileReview
          person={person}
          studies={studies[person.id]}
          work={work[person.id]}
          staged={item.kind === 'edit' ? person.pending_changes : null}
        />
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
              <button type="button" className="btn btn--primary" disabled={busy}
                onClick={() => onPublishEdit(person)}>
                <span className="btn__inner">✓ Publish changes</span>
              </button>
              <ConfirmAction
                label="↩ Discard changes" confirmLabel="Yes, discard them" busyLabel="Discarding…" wide
                question={`Discard the changes ${person.full_name} submitted? They will have to type them again, and nothing tells them it happened.`}
                onConfirm={() => onDiscardEdit(person)}
              />
              {skip}
            </>
          )}
        </div>
      </div>
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
