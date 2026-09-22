'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useViewer } from './Viewer';

/**
 * Header links that know who is signed in.
 *
 * Renders a neutral placeholder until the session is known, so a signed-in
 * visitor never sees "Login / Register" flash first. Under 860px the links
 * collapse into a menu sheet - they no longer fit beside the crest.
 *
 * The sheet is a disclosure, not a dialog: it is a small panel anchored to its
 * button, and the page behind it stays visible and usable. So it takes three
 * of the four things the profile modal does - focus on open, Escape closes,
 * focus returns to the button - and deliberately not the fourth. Trapping Tab
 * inside a 220px dropdown would leave a keyboard user circling a menu with no
 * way out but Escape.
 */
export default function NavAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const who = useViewer();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on navigation.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Escape and click-outside both hand focus back to the button that opened it.
  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>('a, button')?.focus();

    const close = (restoreFocus: boolean) => {
      setOpen(false);
      if (restoreFocus) btnRef.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true); };
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Widening past the breakpoint restores the inline links; without this the
  // sheet stayed open beside them, showing every link twice. matchMedia rather
  // than a resize listener, and the query mirrors globals.css's nav rule.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 861px)');
    const sync = () => { if (mq.matches) setOpen(false); };
    mq.addEventListener('change', sync);
    sync();
    return () => mq.removeEventListener('change', sync);
  }, []);

  async function logOut() {
    await supabase.auth.signOut();
    setOpen(false);
    router.push('/');
  }

  // '/' has to be exact, or startsWith marks Home as the current page
  // everywhere on the site.
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  function NavLink({ href, cta, children }: { href: string; cta?: boolean; children: React.ReactNode }) {
    const on = isActive(href);
    return (
      <Link
        href={href}
        className={`nav__link${cta ? ' nav__link--cta' : ''}${on ? ' nav__link--active' : ''}`}
        aria-current={on ? 'page' : undefined}
      >
        {children}
      </Link>
    );
  }

  const links = (
    <>
      <NavLink href="/directory">Directory</NavLink>
      <NavLink href="/pathways">Pathways</NavLink>
      <NavLink href="/colleges">Colleges</NavLink>
      <NavLink href="/about">About</NavLink>
      <span className="nav__sep" aria-hidden />
      {who === 'unknown' && <span className="nav__link nav__link--placeholder" aria-hidden />}
      {who === 'guest' && (
        <>
          <NavLink href="/login">Login</NavLink>
          <NavLink href="/register" cta>Register</NavLink>
        </>
      )}
      {(who === 'alumnus' || who === 'admin') && (
        <>
          <NavLink href={who === 'admin' ? '/admin' : '/profile'} cta>
            {who === 'admin' ? 'Admin' : 'My profile'}
          </NavLink>
          <button type="button" className="nav__link nav__link--button" onClick={logOut}>Log out</button>
        </>
      )}
    </>
  );

  return (
    <div className="nav__right" ref={menuRef}>
      <div className="nav__links">{links}</div>
      <button
        ref={btnRef}
        type="button"
        className="nav__menu-btn"
        aria-expanded={open}
        aria-controls="nav-sheet"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>{open ? '✕' : '☰'}</span>
      </button>
      {/* Always in the DOM, hidden when closed: aria-controls pointed at an id
          that only existed while open, which is a dangling reference. `hidden`
          takes it out of the tab order and the accessibility tree together. */}
      <div id="nav-sheet" className="nav__sheet" hidden={!open} ref={sheetRef}>{links}</div>
    </div>
  );
}
