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
  newSinceLastVisit: 0,
};

export default function TodayPage() {
  const { lastVisit, refreshCounts } = useAdminShell();
  const [data, setData] = useState<TodayData>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [mail, setMail] = useState<{ domainStatus: string; hint: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setData(await loadToday(lastVisit));
    setLoading(false);
    refreshCounts();
  }, [lastVisit, refreshCounts]);

  useEffect(() => { void load(); }, [load]);

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
      <div className="card today__recent">
        {data.newSinceLastVisit > 0 && (
          <p className="today__new">
            <strong>{data.newSinceLastVisit}</strong> new registration{data.newSinceLastVisit === 1 ? '' : 's'} since you last opened this dashboard.
          </p>
        )}
        {data.arrivals.length === 0 ? (
          <p className="subtitle" style={{ margin: 0, fontSize: '0.88rem' }}>Nobody has joined the directory yet.</p>
        ) : (
          <>
            {/* Arrivals, not decisions. The database records no decisions at
                all yet - migration 15 is what turns this into "who approved
                what, and when" - and saying "recently" over a list of joins
                would be pretending otherwise. */}
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
