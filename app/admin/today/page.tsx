'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { loadToday, type TodayData } from '../adminData';
import { waitedFor } from '../reviewModel';
import { useAdminShell } from '../shell';

/**
 * Where the dashboard opens.
 *
 * It used to open straight into a queue, which answers "what is next" but
 * never "what needs me" - and the mail warning sat above every page for ever,
 * which is how a warning stops being read. This says what is waiting and how
 * long it has waited, what has arrived, and what is quietly wrong, and then
 * sends you to the place that fixes it.
 */

const FALLBACK: TodayData = {
  waiting: {
    registrations: { count: 0, oldest: null, label: null },
    edits: { count: 0, oldest: null, label: null },
    photos: { count: 0, oldest: null, label: null },
    options: { count: 0, oldest: null, label: null },
  },
  health: {
    all: 0, hidden: 0, 'no-login': 0, 'email-unconfirmed': 0,
    starred: 0, stale: 0, 'never-confirmed': 0, 'no-college': 0,
  },
  arrivals: [],
  decisions: [],
  newSinceLastVisit: 0,
};

/** "Approved", "Published 2 changes" — the log's verb, in the office's words. */
const ACTION_WORDS: Record<string, string> = {
  approve: 'Approved',
  reject: 'Rejected',
  publish: 'Published changes to',
  discard: 'Discarded changes to',
  delete: 'Deleted',
  hide: 'Hid',
  restore: 'Restored',
  feature: 'Featured',
  unfeature: 'Unfeatured',
  merge: 'Merged',
  undo: 'Undid a decision on',
};

export default function TodayPage() {
  const { lastVisit, refreshCounts } = useAdminShell();
  const [data, setData] = useState<TodayData>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [mail, setMail] = useState<{ domainStatus: string; hint: string } | null>(null);

  const [undoing, setUndoing] = useState<number | null>(null);
  const [undoError, setUndoError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setData(await loadToday(lastVisit));
    setLoading(false);
    refreshCounts();
  }, [lastVisit, refreshCounts]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Take a decision back.
   *
   * admin_undo puts the columns, the timelines and the staging area back as
   * the event recorded them - and refuses outright if the profile has moved on
   * since, rather than overwriting whatever the person has done in the
   * meantime. The log keeps the undone event and marks it undone: a log you
   * can erase is not a log.
   */
  async function undo(eventId: number) {
    setUndoError(''); setUndoing(eventId);
    const { error } = await supabase.rpc('admin_undo', { p_event_id: eventId });
    setUndoing(null);
    if (error) { setUndoError(error.message); return; }
    await load();
  }

  useEffect(() => {
    void (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return;
      const res = await fetch('/api/admin/mail-health', {
        headers: { Authorization: `Bearer ${session.session.access_token}` },
      }).catch(() => null);
      if (res?.ok) setMail(await res.json());
    })();
  }, []);

  if (loading) return <p className="subtitle">Looking…</p>;

  const w = data.waiting;
  const tiles = [
    { key: 'registration', label: 'Registrations', n: w.registrations.count, oldest: w.registrations.oldest, tone: 'violet' },
    { key: 'edit', label: 'Profile edits', n: w.edits.count, oldest: w.edits.oldest, tone: 'emerald' },
    { key: 'photo', label: 'Campus photos', n: w.photos.count, oldest: w.photos.oldest, tone: 'sky' },
    { key: 'option', label: 'New values', n: w.options.count, oldest: w.options.oldest, tone: 'gold' },
  ];
  const total = tiles.reduce((n, t) => n + t.n, 0);

  const health = [
    { n: data.health['no-login'], need: 'no-login', says: (n: number) => `${n} ${n === 1 ? 'profile has' : 'profiles have'} no login yet` },
    { n: data.health['email-unconfirmed'], need: 'email-unconfirmed', says: (n: number) => `${n} ${n === 1 ? 'person has' : 'people have'} not confirmed their email` },
    { n: data.health.stale, need: 'stale', says: (n: number) => `${n} ${n === 1 ? 'profile has' : 'profiles have'} not been confirmed in over a year` },
    { n: data.health['no-college'], need: 'no-college', says: (n: number) => `${n} typed a college we could not match` },
    { n: data.health.hidden, need: 'hidden', says: (n: number) => `${n} ${n === 1 ? 'profile is' : 'profiles are'} hidden from the directory` },
  ].filter((h) => h.n > 0);

  return (
    <div className="stagger">
      <h2 className="today__h">Waiting on you</h2>
      {total === 0 ? (
        <div className="card empty" style={{ marginBottom: 24 }}>
          <span className="empty__emoji">🎉</span>
          <p style={{ margin: 0 }}>Nothing is waiting. All caught up.</p>
        </div>
      ) : (
        <div className="h-stats" style={{ marginBottom: 26 }}>
          {tiles.map((t) => (
            <Link
              key={t.key}
              href={t.n > 0 ? `/admin/review?kind=${t.key}` : '/admin/review'}
              className={`h-stat h-stat--${t.tone}${t.n === 0 ? ' today__tile--done' : ''}`}
            >
              <span className="h-stat__num">{t.n}</span>
              <span className="h-stat__label">{t.label}</span>
              <span className="today__age">
                {t.n === 0 ? 'nothing waiting' : t.oldest ? `oldest waiting ${waitedFor(t.oldest)}` : ''}
              </span>
            </Link>
          ))}
        </div>
      )}

      <h2 className="today__h">Recently</h2>
      {undoError && <div className="alert alert--error">Could not undo that: {undoError}</div>}
      <div className="card today__recent">
        {data.newSinceLastVisit > 0 && (
          <p className="today__new">
            <strong>{data.newSinceLastVisit}</strong> new registration{data.newSinceLastVisit === 1 ? '' : 's'} since you last opened this dashboard.
          </p>
        )}

        {/* Decisions, at last. This band showed arrivals and said so, because
            the database recorded no decisions at all until migration 15 - a
            registration was approved by overwriting one column, and nothing
            remembered who did it. Arrivals stay underneath, because on a quiet
            week they are the only thing here. */}
        {data.decisions.length > 0 && (
          <>
            <p className="today__recent-head">Decisions</p>
            <ul className="today__list">
              {data.decisions.map((e) => (
                <li key={e.id} className={e.undone_at ? 'today__undone' : undefined}>
                  <span>
                    {ACTION_WORDS[e.action] ?? e.action} {e.summary}
                    {e.undone_at && <span className="badge badge--sm" style={{ marginLeft: 6 }}>undone</span>}
                    {e.reason && <span className="today__reason">“{e.reason}”</span>}
                  </span>
                  <span className="today__when">
                    {e.actor_email.split('@')[0]} · {waitedFor(e.occurred_at)} ago
                    {/* Undo refuses if the profile has moved on since, so this
                        cannot quietly overwrite somebody's newer work - it
                        says so and does nothing. */}
                    {e.undoable && !e.undone_at && (
                      <button type="button" className="link-btn" style={{ marginLeft: 8 }}
                        disabled={undoing === e.id} onClick={() => void undo(e.id)}>
                        {undoing === e.id ? 'undoing…' : 'undo'}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {data.arrivals.length === 0 ? (
          <p className="subtitle" style={{ margin: 0, fontSize: '0.88rem' }}>Nobody has joined the directory yet.</p>
        ) : (
          <>
            <p className="today__recent-head">Newest in the directory</p>
            <ul className="today__list">
              {data.arrivals.map((a) => (
                <li key={a.id}>
                  <span>{a.full_name}</span>
                  <span className="today__when">joined {waitedFor(a.created_at)} ago</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <h2 className="today__h">Worth a look</h2>
      <div className="card today__health">
        {mail && mail.domainStatus !== 'verified' && (
          <p className="today__health-row today__health-row--warn">
            <strong>Email is not working yet.</strong> {mail.hint} Until it is, password resets,
            welcome emails and new-registration alerts are not delivered — use <em>Reset password</em>
            in People to help someone who is locked out.
          </p>
        )}
        {health.length === 0 && (!mail || mail.domainStatus === 'verified') ? (
          <p className="subtitle" style={{ margin: 0, fontSize: '0.88rem' }}>Nothing needs attention.</p>
        ) : (
          health.map((h) => (
            <p key={h.need} className="today__health-row">
              <Link href={`/admin/people?need=${h.need}`} className="link-btn">{h.says(h.n)} →</Link>
            </p>
          ))
        )}
      </div>
    </div>
  );
}
