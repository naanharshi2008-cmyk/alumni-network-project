'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { loadPeople, PAGE, type AlumniRow } from '../adminData';
import { useAdminShell } from '../shell';
import { AccountButton, ConfirmAction, EmptyCard } from '../ui';

/**
 * Everyone already decided on.
 *
 * Without this the dashboard could only ever act on the review queue, so an
 * approved profile - a duplicate, a test row, a person who asked to be taken
 * down - could not be reached at all.
 *
 * Searching and paging happen in the database now. The old list pulled every
 * column of every profile and filtered with includes(), which was fine at
 * seven people and would quietly have shown the wrong answer at a thousand:
 * PostgREST caps a result at a page and says nothing.
 */
export default function PeoplePage() {
  const { refreshCounts } = useAdminShell();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AlumniRow[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionNote, setActionNote] = useState('');

  const load = useCallback(async (q: string, p: number) => {
    setLoading(true);
    const data = await loadPeople(q, p);
    setRows(data.rows);
    setTotal(data.total);
    setTruncated(data.truncated);
    if (data.error) setActionError('Could not load the alumni list: ' + data.error);
    setLoading(false);
  }, []);

  // Typing searches the database, so wait for a pause rather than firing per key.
  useEffect(() => {
    const t = setTimeout(() => { void load(query, page); }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, page, load]);

  // Hiding is the reversible half of deleting: the profile leaves the public
  // view immediately but the row, the photo and the login all survive, so a
  // mistake costs a click rather than the person's whole record.
  async function handleSetStatus(person: AlumniRow, status: 'approved' | 'rejected') {
    setActionError(''); setActionNote('');
    const { error } = await supabase.from('alumni')
      .update({ approval_status: status })
      .eq('id', person.id)
      .select('id');
    if (error) { setActionError('Could not update that profile: ' + error.message); return; }
    setRows((prev) => prev.map((p) => (p.id === person.id ? { ...p, approval_status: status } : p)));
    setActionNote(
      status === 'approved'
        ? `${person.full_name} is back in the public directory.`
        : `${person.full_name} is hidden from the public directory.`,
    );
  }

  async function handleToggleFeatured(person: AlumniRow) {
    setActionError(''); setActionNote('');
    const next = !person.featured;
    const { data, error } = await supabase.from('alumni')
      .update({ featured: next })
      .eq('id', person.id)
      .select('id, featured');
    if (error || !data?.length) {
      setActionError('Could not change featuring: ' + (error?.message ?? 'no row was updated.'));
      return;
    }
    setRows((prev) => prev.map((p) => (p.id === person.id ? { ...p, featured: next } : p)));
    setActionNote(next
      ? `${person.full_name} is featured on the home page.`
      : `${person.full_name} is no longer featured; the home page fills the place automatically.`);
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
    setRows((prev) => prev.filter((p) => p.id !== person.id));
    setTotal((t) => Math.max(0, t - 1));
    setActionNote(
      `Deleted ${body.name ?? person.full_name}.` +
      (body.warnings?.length ? ` Note: ${body.warnings.join('; ')}.` : ''),
    );
    refreshCounts();
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="stagger">
      <h2 style={{ margin: '0 0 6px', fontSize: '1.1rem' }}>Everyone in the directory</h2>
      <p className="subtitle" style={{ margin: '0 0 16px', fontSize: '0.88rem' }}>
        Everyone who has been approved or hidden. This is where to remove test
        rows, duplicates and anyone who asks to be taken down.
      </p>

      <div className="search" style={{ marginBottom: 18 }}>
        <input
          type="text"
          placeholder="Search name, email, phone, college…"
          value={query}
          onChange={(e) => { setPage(0); setQuery(e.target.value); }}
          aria-label="Search alumni"
        />
      </div>

      {actionError && <div className="alert alert--error">{actionError}</div>}
      {actionNote && <div className="alert alert--success">{actionNote}</div>}

      {loading ? (
        <p className="subtitle">Looking…</p>
      ) : rows.length === 0 ? (
        <EmptyCard emoji={query ? '🔍' : '👥'} text={query ? `Nothing matches “${query}”.` : 'No approved or hidden profiles yet.'} />
      ) : (
        <>
          <p className="result-count" style={{ marginBottom: 14 }}>
            {total === rows.length ? `${total} profiles` : `${rows.length} of ${total} profiles`}
            {truncated && ' — narrow the search to see the rest'}
          </p>

          {rows.map((person) => (
            <div key={person.id} className="card" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <strong>{person.full_name}</strong>{' '}
                  <span className={`badge badge--sm${person.approval_status === 'approved' ? ' badge--ok' : ''}`}>
                    {person.approval_status === 'approved' ? 'In the directory' : 'Hidden'}
                  </span>
                  {person.featured && <span className="badge badge--sm badge--star">★ Featured</span>}
                  <div className="subtitle" style={{ margin: '4px 0 0', fontSize: '0.84rem' }}>
                    {person.personal_email || 'no email'}
                    {person.personal_email && !person.email_verified_at && (
                      <span className="badge badge--sm" style={{ marginLeft: 6 }} title="They have not opened the confirmation link yet">
                        email unconfirmed
                      </span>
                    )}
                    {person.user_id ? '' : ' · no login yet'}
                    {person.class_of ? ` · Class of ${person.class_of}` : ''}
                    {person.college_name_raw ? ` · ${person.college_name_raw}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {person.approval_status === 'approved' && (
                    <button type="button" className={`btn btn--ghost star-btn${person.featured ? ' star-btn--on' : ''}`}
                      aria-pressed={!!person.featured}
                      title={person.featured ? 'Remove from the home page' : 'Feature on the home page'}
                      onClick={() => handleToggleFeatured(person)}>
                      <span className="btn__inner">{person.featured ? '★ Featured' : '☆ Feature'}</span>
                    </button>
                  )}
                  {person.approval_status === 'approved' ? (
                    <button type="button" className="btn btn--ghost" onClick={() => handleSetStatus(person, 'rejected')}>
                      <span className="btn__inner">Hide</span>
                    </button>
                  ) : (
                    <button type="button" className="btn btn--ghost" onClick={() => handleSetStatus(person, 'approved')}>
                      <span className="btn__inner">Restore</span>
                    </button>
                  )}
                  <AccountButton person={person} />
                  <span style={{ marginLeft: 'auto' }}>
                    <ConfirmAction
                      label="🗑 Delete" confirmLabel="Yes, delete permanently" busyLabel="Deleting…" wide
                      question={<>Permanently delete <strong>{person.full_name}</strong>? Their profile, photo and login are removed. This cannot be undone.</>}
                      onConfirm={() => handleDelete(person)}
                    />
                  </span>
                </div>
              </div>
            </div>
          ))}

          {pages > 1 && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
              <button type="button" className="btn btn--ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <span className="btn__inner">← Previous</span>
              </button>
              <span className="subtitle" style={{ fontSize: '0.85rem' }}>Page {page + 1} of {pages}</span>
              <button type="button" className="btn btn--ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                <span className="btn__inner">Next →</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
