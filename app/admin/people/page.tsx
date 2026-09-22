'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  loadPeople, loadPeopleFacets, PAGE,
  type AlumniRow, type PeopleFacets, type PeopleNeed,
} from '../adminData';
import { useAdminShell } from '../shell';
import { AccountButton, ConfirmAction, EmptyCard, TabButton, TempPassword } from '../ui';

/** The states worth asking for, in the order the office asks for them. */
const NEEDS: { key: PeopleNeed; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'no-login', label: 'No login yet' },
  { key: 'email-unconfirmed', label: 'Email unconfirmed' },
  { key: 'stale', label: 'Not confirmed in a year' },
  { key: 'never-confirmed', label: 'Never confirmed' },
  { key: 'no-college', label: 'College unmatched' },
  { key: 'starred', label: 'Featured' },
  { key: 'hidden', label: 'Hidden' },
  { key: 'imported', label: 'Imported — waiting for them' },
];

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
  const router = useRouter();
  const params = useSearchParams();
  const urlNeed = params.get('need') as PeopleNeed | null;
  const [need, setNeed] = useState<PeopleNeed>(
    urlNeed && NEEDS.some((n) => n.key === urlNeed) ? urlNeed : 'all',
  );
  const [facets, setFacets] = useState<PeopleFacets | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AlumniRow[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionNote, setActionNote] = useState('');
  // Who the next bulk action applies to. Ids rather than rows, so a row that
  // reloads under a new object identity stays ticked.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  // Passwords come back once and are never retrievable again, so they are
  // held on screen until the office says it has copied them.
  const [logins, setLogins] = useState<{ name: string; password?: string; error?: string }[] | null>(null);

  const load = useCallback(async (q: string, p: number, n: PeopleNeed) => {
    setLoading(true);
    const data = await loadPeople(q, p, n);
    setRows(data.rows);
    // A tick means "this person", and the people on screen have just changed.
    // Carrying ticks across a filter is how a bulk action hits someone the
    // office cannot see.
    setSelected(new Set());
    setTotal(data.total);
    setTruncated(data.truncated);
    if (data.error) setActionError('Could not load the alumni list: ' + data.error);
    setLoading(false);
  }, []);

  // Typing searches the database, so wait for a pause rather than firing per key.
  useEffect(() => {
    const t = setTimeout(() => { void load(query, page, need); }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, page, need, load]);

  useEffect(() => { void loadPeopleFacets().then(setFacets); }, []);

  function chooseNeed(next: PeopleNeed) {
    setNeed(next);
    setPage(0);
    // In the URL so a filtered list is a link, and so the opening view's
    // health lines can point straight at one.
    router.replace(next === 'all' ? '/admin/people' : `/admin/people?need=${next}`);
  }

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

  /**
   * PostgREST answers a filtered UPDATE with the rows it actually changed, and
   * a row that RLS hid is simply absent - no error, no warning. One at a time
   * that silence is survivable; across twenty people it is how the office ends
   * up believing something happened that did not. So every bulk write asks for
   * the ids back and reports the difference.
   */
  async function bulkUpdate(
    ids: string[],
    patch: Record<string, unknown>,
    apply: (p: AlumniRow) => AlumniRow,
    describe: (n: number) => string,
    label: string,
  ) {
    if (!ids.length) return;
    setActionError(''); setActionNote(''); setBusy(label);
    const { data, error } = await supabase.from('alumni').update(patch).in('id', ids).select('id');
    setBusy('');
    if (error) { setActionError('That did not go through: ' + error.message); return; }
    const changed = new Set((data ?? []).map((r) => r.id as string));
    setRows((prev) => prev.map((p) => (changed.has(p.id) ? apply(p) : p)));
    setSelected(new Set());
    const missed = ids.length - changed.size;
    setActionNote(describe(changed.size) + (missed > 0
      ? ` ${missed} did not change — reload the list and try those again.`
      : ''));
    void loadPeopleFacets().then(setFacets);
    refreshCounts();
  }

  function bulkHide(status: 'approved' | 'rejected') {
    const ids = rows.filter((p) => selected.has(p.id) && p.approval_status !== status).map((p) => p.id);
    return bulkUpdate(
      ids, { approval_status: status }, (p) => ({ ...p, approval_status: status }),
      (n) => status === 'approved'
        ? `${n} ${n === 1 ? 'profile is' : 'profiles are'} back in the public directory.`
        : `${n} ${n === 1 ? 'profile is' : 'profiles are'} hidden from the public directory.`,
      status === 'approved' ? 'restore' : 'hide',
    );
  }

  function bulkFeature(next: boolean) {
    // Featuring somebody who is hidden would put a name on the home page that
    // the home page cannot show, so those are left out and said so.
    const eligible = rows.filter((p) => selected.has(p.id) && p.featured !== next
      && (!next || p.approval_status === 'approved'));
    const skipped = next
      ? rows.filter((p) => selected.has(p.id) && p.approval_status !== 'approved').length
      : 0;
    return bulkUpdate(
      eligible.map((p) => p.id), { featured: next }, (p) => ({ ...p, featured: next }),
      (n) => (next
        ? `${n} ${n === 1 ? 'profile is' : 'profiles are'} featured on the home page.`
        : `${n} ${n === 1 ? 'profile is' : 'profiles are'} no longer featured; the home page fills the places automatically.`)
        + (skipped ? ` ${skipped} hidden ${skipped === 1 ? 'profile was' : 'profiles were'} left out.` : ''),
      next ? 'feature' : 'unfeature',
    );
  }

  /**
   * Logins, one at a time on purpose.
   *
   * Each call returns a password that is shown once and never again, so these
   * cannot be fired off in parallel and summarised as "12 succeeded" - every
   * one of them has to come back and be read. A failure part-way through stops
   * nothing: the ones already created are still listed.
   */
  async function bulkCreateLogins() {
    const people = rows.filter((p) => selected.has(p.id) && !p.user_id);
    if (!people.length) return;
    setActionError(''); setActionNote(''); setBusy('logins'); setLogins([]);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setBusy(''); setActionError('Your session expired, please sign in again.'); return; }

    const out: { name: string; password?: string; error?: string }[] = [];
    for (const person of people) {
      try {
        const res = await fetch('/api/admin/create-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ alumniId: person.id }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) out.push({ name: person.full_name, error: body.error ?? 'did not work' });
        else out.push({ name: person.full_name, password: body.temporaryPassword });
      } catch {
        out.push({ name: person.full_name, error: 'could not reach the server' });
      }
      setLogins([...out]);
    }
    setBusy('');
    // Read the list back rather than guessing at it: the passwords above are
    // the record of what happened, and the rows should agree with the server.
    await load(query, page, need);
    void loadPeopleFacets().then(setFacets);
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
  const chosen = rows.filter((p) => selected.has(p.id));
  const allOnPage = rows.length > 0 && chosen.length === rows.length;
  const canRestore = chosen.some((p) => p.approval_status !== 'approved');
  const canHide = chosen.some((p) => p.approval_status === 'approved');
  const canFeature = chosen.some((p) => p.approval_status === 'approved' && !p.featured);
  const canUnfeature = chosen.some((p) => p.featured);
  const needLogins = chosen.filter((p) => !p.user_id).length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="stagger">
      <h2 style={{ margin: '0 0 6px', fontSize: '1.1rem' }}>Everyone in the directory</h2>
      <p className="subtitle" style={{ margin: '0 0 16px', fontSize: '0.88rem' }}>
        Everyone who has been approved or hidden. This is where to remove test
        rows, duplicates and anyone who asks to be taken down.
      </p>

      <div className="chips" style={{ marginBottom: 14 }}>
        {NEEDS.map((n) => (
          <TabButton
            key={n.key}
            active={need === n.key}
            onClick={() => chooseNeed(n.key)}
            label={n.label}
            count={facets ? facets[n.key] : 0}
          />
        ))}
      </div>

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
          {chosen.length > 0 && (
            <div className="bulk-bar">
              <label className="bulk-bar__all">
                <input
                  type="checkbox" checked={allOnPage}
                  onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((p) => p.id)))}
                />
                {chosen.length} selected
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {canHide && (
                  <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => void bulkHide('rejected')}>
                    <span className="btn__inner">{busy === 'hide' ? 'Hiding…' : 'Hide'}</span>
                  </button>
                )}
                {canRestore && (
                  <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => void bulkHide('approved')}>
                    <span className="btn__inner">{busy === 'restore' ? 'Restoring…' : 'Restore'}</span>
                  </button>
                )}
                {canFeature && (
                  <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => void bulkFeature(true)}>
                    <span className="btn__inner">{busy === 'feature' ? 'Featuring…' : '★ Feature'}</span>
                  </button>
                )}
                {canUnfeature && (
                  <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => void bulkFeature(false)}>
                    <span className="btn__inner">{busy === 'unfeature' ? 'Working…' : '☆ Unfeature'}</span>
                  </button>
                )}
                {needLogins > 0 && (
                  <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => void bulkCreateLogins()}>
                    <span className="btn__inner">
                      {busy === 'logins' ? 'Creating…' : `Create ${needLogins} login${needLogins === 1 ? '' : 's'}`}
                    </span>
                  </button>
                )}
                <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => setSelected(new Set())}>
                  <span className="btn__inner">Clear</span>
                </button>
              </div>
            </div>
          )}

          {/* Deleting is deliberately absent from the bar. It takes the
              profile, the photo and the login, there is no undo, and a
              mis-ticked box is far too cheap a way to lose twenty of them. */}
          {logins && (
            <div className="card" style={{ marginBottom: 16 }}>
              <strong>Temporary passwords</strong>
              <p className="subtitle" style={{ margin: '4px 0 12px', fontSize: '0.85rem' }}>
                Shown once. Send each one privately; they sign in with the email
                or phone on their profile and then choose their own password.
              </p>
              {logins.map((l) => (
                <div key={l.name} style={{ marginBottom: 14 }}>
                  <p style={{ margin: '0 0 6px' }}><strong>{l.name}</strong></p>
                  {l.password
                    ? <TempPassword password={l.password}>&nbsp;</TempPassword>
                    : <p className="field__error field__error--static">Could not create a login — {l.error}.</p>}
                </div>
              ))}
              {!busy && (
                <button type="button" className="btn btn--ghost" onClick={() => setLogins(null)}>
                  <span className="btn__inner">Done, I have copied them</span>
                </button>
              )}
            </div>
          )}

          <p className="result-count" style={{ marginBottom: 14 }}>
            {total === rows.length ? `${total} profiles` : `${rows.length} of ${total} profiles`}
            {truncated && ' — narrow the search to see the rest'}
          </p>

          {rows.map((person) => (
            <div key={person.id} className="card" style={{ marginBottom: 14 }}>
              <label className="card-select">
                <input type="checkbox" checked={selected.has(person.id)} onChange={() => toggle(person.id)} />
                <span className="sr-only">Select {person.full_name}</span>
                <span aria-hidden>Select</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <Link href={`/admin/people/${person.id}`}><strong>{person.full_name}</strong></Link>{' '}
                  <span className={`badge badge--sm${person.approval_status === 'approved' ? ' badge--ok' : ''}`}>
                    {person.approval_status === 'approved' ? 'In the directory'
                      : person.approval_status === 'pending' ? 'Waiting for them' : 'Hidden'}
                  </span>
                  {person.in_gap_year && <span className="badge badge--sm" title="Unlisted until they say where they joined">In a year out</span>}
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
                  <Link href={`/admin/people/${person.id}`} className="btn btn--ghost">
                    <span className="btn__inner">Edit</span>
                  </Link>
                  {person.approval_status === 'approved' ? (
                    <button type="button" className="btn btn--ghost" onClick={() => handleSetStatus(person, 'rejected')}>
                      <span className="btn__inner">Hide</span>
                    </button>
                  ) : person.approval_status === 'rejected' ? (
                    <button type="button" className="btn btn--ghost" onClick={() => handleSetStatus(person, 'approved')}>
                      <span className="btn__inner">Restore</span>
                    </button>
                  ) : null}
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
