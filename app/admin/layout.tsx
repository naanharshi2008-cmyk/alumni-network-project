'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import Crest from '../../lib/Crest';
import { ADMIN_LOGIN_DOMAIN, LAST_VISIT_KEY, loadCounts, type Counts } from './adminData';
import { ShellContext } from './shell';

/**
 * The shell every part of the dashboard sits in.
 *
 * The gate, the nav and the mail-health warning used to be re-run by a single
 * page that also loaded all eight tabs' data on mount. They live here now, so
 * each area below can load its own data and nothing else - and so moving
 * between areas keeps the shell mounted instead of re-checking the session.
 *
 * The gate is a courtesy, not the boundary: row-level security decides what an
 * account can actually read or write. What it prevents is a signed-in alumnus
 * wandering in and seeing a page built for someone else.
 */

const AREAS = [
  { href: '/admin/today', label: 'Today', hint: 'What is waiting, what arrived, what needs a look' },
  { href: '/admin/review', label: 'Review', hint: 'Everything waiting for a decision' },
  { href: '/admin/people', label: 'People', hint: 'Everyone already decided on' },
  { href: '/admin/data', label: 'Data', hint: 'Names, values and tidying up' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authState, setAuthState] = useState<'checking' | 'denied' | 'ok'>('checking');
  const [counts, setCounts] = useState<Counts>({ registrations: 0, edits: 0, photos: 0, options: 0 });
  const [lastVisit, setLastVisit] = useState<number | null>(null);

  const refreshCounts = useCallback(() => { void loadCounts().then(setCounts); }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (!session) { router.replace('/login'); return; }
      // A logged-in alumnus previously reached this page and saw every pending
      // applicant's email and phone number. The address decides access now.
      if (!session.user.email?.toLowerCase().endsWith(`@${ADMIN_LOGIN_DOMAIN}`)) {
        setAuthState('denied');
        return;
      }
      setAuthState('ok');

      // Read it, but do NOT stamp a new one here: this effect runs on every
      // mount, so writing now meant a single refresh wiped the "new since you
      // last looked" marker for good. The stamp happens on the way out instead
      // (see the pagehide handler below), which is what "last visit" means.
      const stored = window.localStorage.getItem(LAST_VISIT_KEY);
      setLastVisit(stored ? Number(stored) : null);

      void loadCounts().then((c) => { if (active) setCounts(c); });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login');
    });

    // Stamp the visit as the admin leaves, so everything that arrived during
    // this session still counts as "new" until they actually come back.
    const stamp = () => window.localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
    window.addEventListener('pagehide', stamp);

    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener('pagehide', stamp);
      stamp();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (authState === 'checking') {
    return <div className="container"><p className="subtitle">Checking your access…</p></div>;
  }

  if (authState === 'denied') {
    return (
      <div className="container container--narrow">
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <span className="empty__emoji">🔒</span>
          <h2>Staff only</h2>
          <p className="subtitle">
            This dashboard is limited to administrator accounts. If you are an alumnus,
            your own details live on your profile page.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            <button type="button" onClick={() => router.replace('/profile')} className="btn btn--primary">
              <span className="btn__inner">Go to my profile</span>
            </button>
            <button type="button" onClick={handleLogout} className="btn btn--ghost">
              <span className="btn__inner">Log out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const waiting = counts.registrations + counts.edits + counts.photos + counts.options;

  return (
    <ShellContext.Provider value={{ counts, refreshCounts, lastVisit }}>
      <div className="container">
        <div className="admin-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Crest />
            <h1 style={{ margin: 0 }}>Admin Dashboard</h1>
          </div>
          <button type="button" onClick={handleLogout} className="btn btn--neutral">
            <span className="btn__inner">Log Out</span>
          </button>
        </div>

        <nav className="admin-nav" aria-label="Dashboard sections">
          {AREAS.map((a) => {
            const on = pathname === a.href || pathname.startsWith(`${a.href}/`);
            const badge = a.href === '/admin/today' ? waiting : 0;
            return (
              <Link
                key={a.href} href={a.href} title={a.hint}
                className={`admin-nav__link${on ? ' admin-nav__link--on' : ''}`}
                aria-current={on ? 'page' : undefined}
              >
                {a.label}
                {badge > 0 && <span className="admin-nav__badge">{badge}</span>}
              </Link>
            );
          })}
        </nav>

        <Suspense fallback={<p className="subtitle">Loading…</p>}>{children}</Suspense>
      </div>
    </ShellContext.Provider>
  );
}
