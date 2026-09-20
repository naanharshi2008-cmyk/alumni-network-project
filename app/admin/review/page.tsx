'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import {
  loadReview, type AlumniRow, type HigherStudyRow, type PendingPhoto, type WorkExperienceRow,
} from '../adminData';
import { splitStaged } from '../editFields';
import { useAdminShell } from '../shell';
import AddAlumnus from '../AddAlumnus';
import {
  ConfirmAction, EditDiff, EmptyCard, PersonDetails, PersonHeader, TabButton, TabIntro,
} from '../ui';

/**
 * Everything waiting for a decision.
 *
 * Registrations, edits to published profiles, and campus photos - the three
 * queues where somebody is actually waiting on the school. Values people typed
 * and names we could not match are decisions too, but they are tidying rather
 * than someone's application, so they live on the Data bench.
 */

type Queue = 'registrations' | 'edits' | 'photos';

export default function ReviewPage() {
  const { refreshCounts, lastVisit } = useAdminShell();
  const [queue, setQueue] = useState<Queue>('registrations');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [pending, setPending] = useState<AlumniRow[]>([]);
  const [pendingEdits, setPendingEdits] = useState<AlumniRow[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [higherStudiesMap, setHigherStudiesMap] = useState<Record<string, HigherStudyRow[]>>({});
  const [workExperienceMap, setWorkExperienceMap] = useState<Record<string, WorkExperienceRow[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadReview();
    setPending(data.pending);
    setPendingEdits(data.pendingEdits);
    setPendingPhotos(data.photos);
    setHigherStudiesMap(data.higherStudies);
    setWorkExperienceMap(data.workExperience);
    if (data.error) setActionError('Could not load everything: ' + data.error);
    setLoading(false);
    refreshCounts();
  }, [refreshCounts]);

  useEffect(() => { void load(); }, [load]);

  const newSinceLastVisit = useMemo(() => {
    if (!lastVisit) return 0;
    return pending.filter((p) => new Date(p.created_at).getTime() > lastVisit).length;
  }, [pending, lastVisit]);

  /* ── Registration actions ──────────────────────────────────────────────── */
  // "You're live" emails. Never blocks the approval, and the route itself
  // checks each row really is approved before emailing anyone.
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

  async function handleApprove(id: string) {
    setActionError('');
    // .select() is what turns "the statement ran" into "a row actually
    // changed". Without it PostgREST answers success with zero rows affected
    // whenever a row is filtered out, and the card below disappears from the
    // queue either way - so the dashboard would report an approval that never
    // happened, and only a page reload would give it away.
    const { data: hit, error } = await supabase.from('alumni')
      .update({ approval_status: 'approved', modification_status: 'none' })
      .eq('id', id)
      .select('id');
    if (error) { setActionError('Could not approve: ' + error.message); return; }
    if (!hit?.length) { setActionError('Nothing was approved — that profile may have been changed or removed. Reload and try again.'); return; }
    const person = pending.find((p) => p.id === id);
    void notifyApproved([id]);
    setActionNote(`Approved ${person?.full_name ?? 'that registration'} — they're live on the directory now.`);
    setPending((prev) => prev.filter((p) => p.id !== id));
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    refreshCounts();
  }

  async function handleApproveSelected() {
    setActionError('');
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    // One statement rather than a loop: a partial batch is worse than an
    // obvious failure, and the admin needs to know exactly what happened.
    const { data: hits, error } = await supabase.from('alumni')
      .update({ approval_status: 'approved', modification_status: 'none' })
      .in('id', ids)
      .select('id');
    setBulkBusy(false);
    if (error) { setActionError('Could not approve the selected people: ' + error.message); return; }
    const done = hits?.length ?? 0;
    if (done === 0) { setActionError('Nothing was approved — reload and try again.'); return; }
    if (done < ids.length) {
      setActionError(`Only ${done} of ${ids.length} were approved. Reload to see which are still waiting.`);
    }
    void notifyApproved((hits ?? []).map((h: { id: string }) => h.id));
    setActionNote(`Approved ${done} ${done === 1 ? 'person' : 'people'} — they're live on the directory now.`);
    setPending((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
    refreshCounts();
  }

  async function handleReject(id: string, reason: string) {
    setActionError('');
    const person = pending.find((p) => p.id === id);
    const { data: hit, error } = await supabase.from('alumni')
      .update({ approval_status: 'rejected', rejection_reason: reason.trim() || null })
      .eq('id', id)
      .select('id');
    if (error) { setActionError('Could not reject: ' + error.message); return; }
    if (!hit?.length) { setActionError('Nothing was rejected — reload and try again.'); return; }
    setActionNote(`Rejected ${person?.full_name ?? 'that registration'}.`);
    setPending((prev) => prev.filter((p) => p.id !== id));
    refreshCounts();
  }

  async function handleDelete(person: AlumniRow) {
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
    setPending((prev) => prev.filter((p) => p.id !== person.id));
    setPendingEdits((prev) => prev.filter((p) => p.id !== person.id));
    setActionNote(
      `Deleted ${body.name ?? person.full_name}.` +
      (body.warnings?.length ? ` Note: ${body.warnings.join('; ')}.` : ''),
    );
    refreshCounts();
  }

  /* ── Campus photos ─────────────────────────────────────────────────────── */
  async function handlePhoto(photo: PendingPhoto, decision: 'approved' | 'rejected') {
    setActionError(''); setActionNote('');
    const { data, error } = await supabase.from('college_photos')
      .update({ status: decision, reviewed_at: new Date().toISOString() })
      .eq('id', photo.id)
      .select('id');
    if (error || !data?.length) {
      setActionError('Could not update that photo: ' + (error?.message ?? 'no row changed.'));
      return;
    }
    setPendingPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    setActionNote(decision === 'approved'
      ? 'Published — it is on the college page now.'
      : 'Hidden. The file stays until you delete it.');
    refreshCounts();
  }

  async function handleDeletePhoto(photo: PendingPhoto) {
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
    setPendingPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    setActionNote('Deleted, file and all.');
    refreshCounts();
  }

  /* ── Edit-review actions ───────────────────────────────────────────────── */
  async function handleApproveEdit(person: AlumniRow) {
    setActionError('');
    const staged = person.pending_changes;
    if (!staged) { setActionError('Nothing staged for this person.'); return; }

    // Only the fields the profile editor can actually set. The blob is written
    // by the alumnus and this update runs as the school, so spreading it whole
    // published anything they cared to put in it - see editFields.ts.
    const { higher_studies, work_experience } = staged;
    const { columns, unknown } = splitStaged(staged);
    if (unknown.length) console.warn('Staged keys refused at publish:', unknown.map(([k]) => k));

    const { data: published, error } = await supabase.from('alumni')
      // last_updated sits AFTER the spread on purpose: publishing is the
      // moment the public content changes, so publish time always wins.
      .update({ ...columns, modification_status: 'none', pending_changes: null, last_updated: new Date().toISOString() })
      .eq('id', person.id)
      .select('id');
    if (error) { setActionError('Could not approve edits: ' + error.message); return; }
    if (!published?.length) { setActionError('Nothing was published — reload and try again.'); return; }

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
        setActionError(`Published the profile details, but could not update ${table.replace('_', ' ')}: ${delErr.message}`);
        return;
      }
      if (rowsRaw.length) {
        const { error: insErr } = await supabase.from(table).insert(
          rowsRaw.map((r: any) => ({ ...r, alumni_id: person.id })),
        );
        if (insErr) {
          setActionError(
            `Published the profile details, but their ${table.replace('_', ' ')} entries did not save (${insErr.message}). ` +
            'Ask them to re-enter that section from their profile page.',
          );
          return;
        }
      }
    }
    setActionNote(
      `Published ${person.full_name}'s changes — the directory shows them now.` +
      (unknown.length ? ` ${unknown.length} unrecognised value(s) were not published.` : ''),
    );
    setPendingEdits((prev) => prev.filter((p) => p.id !== person.id));
    refreshCounts();
  }

  async function handleRejectEdit(id: string) {
    setActionError('');
    // The live columns were never touched, so discarding is just clearing the
    // staging area - no restore step and nothing for the public to notice.
    const { data: hit, error } = await supabase.from('alumni')
      .update({ modification_status: 'rejected', pending_changes: null })
      .eq('id', id)
      .select('id');
    if (error) { setActionError('Could not discard the edits: ' + error.message); return; }
    if (!hit?.length) { setActionError('Nothing was discarded — reload and try again.'); return; }
    setPendingEdits((prev) => prev.filter((p) => p.id !== id));
    refreshCounts();
  }

  if (loading) return <p className="subtitle">Loading what is waiting…</p>;

  return (
    <>
      {newSinceLastVisit > 0 && (
        <div className="alert alert--success" style={{ marginBottom: 16 }}>
          <strong>{newSinceLastVisit}</strong> new registration{newSinceLastVisit === 1 ? '' : 's'} since you last opened this dashboard.
        </div>
      )}

      <div className="chips" style={{ marginBottom: 24 }}>
        <TabButton active={queue === 'registrations'} onClick={() => setQueue('registrations')}
          label="📋 New Registrations" count={pending.length} />
        <TabButton active={queue === 'edits'} onClick={() => setQueue('edits')}
          label="✏️ Pending Edits" count={pendingEdits.length} />
        <TabButton active={queue === 'photos'} onClick={() => setQueue('photos')}
          label="📷 Campus Photos" count={pendingPhotos.length} />
      </div>

      {actionError && <div className="alert alert--error">{actionError}</div>}
      {actionNote && <div className="alert alert--success">{actionNote}</div>}

      {queue === 'registrations' && (
        <div className="stagger">
          <AddAlumnus onAdded={load} setError={setActionError} />
          {pending.length === 0 ? (
            <EmptyCard emoji="🎉" text="No pending registrations right now." />
          ) : (
            <>
              {pending.length > 1 && (
                <div className="bulk-bar">
                  <label className="bulk-bar__all">
                    <input
                      type="checkbox"
                      checked={selected.size === pending.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(pending.map((p) => p.id)) : new Set())}
                    />
                    <span>Select all {pending.length}</span>
                  </label>
                  <button
                    type="button" className="btn btn--primary"
                    disabled={selected.size === 0 || bulkBusy}
                    onClick={handleApproveSelected}
                  >
                    <span className="btn__inner">
                      {bulkBusy ? 'Approving…' : `✓ Approve ${selected.size || ''} selected`.trim()}
                    </span>
                  </button>
                </div>
              )}
              {pending.map((person) => (
                <div key={person.id} className="card" style={{ marginBottom: 18 }}>
                  {pending.length > 1 && (
                    <label className="card-select">
                      <input
                        type="checkbox"
                        checked={selected.has(person.id)}
                        onChange={(e) => setSelected((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(person.id); else n.delete(person.id);
                          return n;
                        })}
                      />
                      <span>Select</span>
                    </label>
                  )}
                  <PersonHeader person={person} isNew={!!lastVisit && new Date(person.created_at).getTime() > lastVisit} />
                  <PersonDetails
                    person={person}
                    higherStudies={higherStudiesMap[person.id]}
                    workExperience={workExperienceMap[person.id]}
                  />
                  <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => handleApprove(person.id)} className="btn btn--primary">
                      <span className="btn__inner">✓ Approve</span>
                    </button>
                    <ConfirmAction
                      label="✕ Reject" confirmLabel="Yes, reject" busyLabel="Rejecting…" wide
                      question={<>Reject <strong>{person.full_name}</strong>? They stay out of the directory.</>}
                      reason={{ placeholder: 'Reason (optional, for your records)' }}
                      onConfirm={(why) => handleReject(person.id, why)}
                    />
                    <span style={{ marginLeft: 'auto' }}>
                      <ConfirmAction
                        label="🗑 Delete" confirmLabel="Yes, delete permanently" busyLabel="Deleting…" wide
                        question={<>Permanently delete <strong>{person.full_name}</strong>? Their profile, photo and login are removed. This cannot be undone.</>}
                        onConfirm={() => handleDelete(person)}
                      />
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {queue === 'edits' && (
        <div className="stagger">
          {pendingEdits.length === 0 ? (
            <EmptyCard emoji="✨" text="No profile edits waiting for review." />
          ) : pendingEdits.map((person) => (
            <div key={person.id} className="card" style={{ marginBottom: 24 }}>
              <PersonHeader person={person} />
              <p className="subtitle" style={{ fontSize: '0.84rem', margin: '12px 0 10px' }}>
                The directory still shows the approved version on the left. Nothing here is public yet.
              </p>
              <EditDiff person={person} />
              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => handleApproveEdit(person)} className="btn btn--primary">
                  <span className="btn__inner">✓ Publish changes</span>
                </button>
                <ConfirmAction
                  label="↩ Discard changes" confirmLabel="Yes, discard them" busyLabel="Discarding…"
                  question={`Discard the changes ${person.full_name} submitted? They will have to type them again, and nothing tells them it happened.`}
                  onConfirm={() => handleRejectEdit(person.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {queue === 'photos' && (
        <div className="stagger">
          <TabIntro title="Campus photos from students">
            Photos offered by seniors studying at each college. Nothing is public until you
            publish it, and each one appears with the name of whoever shared it.
          </TabIntro>
          {pendingPhotos.length === 0 ? (
            <EmptyCard emoji="📷" text="No photos waiting." />
          ) : (
            pendingPhotos.map((p) => {
              const college = Array.isArray(p.college) ? p.college[0] : p.college;
              const who = Array.isArray(p.alumni) ? p.alumni[0] : p.alumni;
              return (
                <div key={p.id} className="card" style={{ marginBottom: 16 }}>
                  <img
                    src={p.url} alt={p.caption ?? ''} loading="lazy"
                    style={{ width: '100%', maxHeight: 300, objectFit: 'cover', borderRadius: 'var(--r-sm)', marginBottom: 12 }}
                  />
                  <strong>{college?.name ?? 'Unknown college'}</strong>
                  <p className="subtitle" style={{ margin: '4px 0 10px', fontSize: '0.86rem' }}>
                    {p.caption || <em>No caption</em>}
                    {who ? ` — shared by ${who.full_name}${who.class_of ? `, class of ${who.class_of}` : ''}` : ''}
                  </p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn--primary" onClick={() => handlePhoto(p, 'approved')}>
                      <span className="btn__inner">✓ Publish</span>
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => handlePhoto(p, 'rejected')}>
                      <span className="btn__inner">Hide</span>
                    </button>
                    <ConfirmAction
                      label="🗑 Delete"
                      confirmLabel="Yes, delete it"
                      busyLabel="Deleting…"
                      question="Delete this photo and its file? This cannot be undone."
                      onConfirm={() => handleDeletePhoto(p)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

    </>
  );
}
