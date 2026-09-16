'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

type Who = 'unknown' | 'guest' | 'alumnus' | 'admin';

const ADMIN_DOMAIN = '@veveaham-admin.local';

/**
 * Header links that know who is signed in.
 *
 * Renders a neutral placeholder until the session is known, so a signed-in
 * visitor never sees "Login / Register" flash first. Under 720px the links
 * collapse into a menu sheet - they no longer fit beside the crest.
 */
export default function NavAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const [who, setWho] = useState<Who>('unknown');
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const classify = (email: string | null | undefined): Who =>
      !email ? 'guest' : email.endsWith(ADMIN_DOMAIN) ? 'admin' : 'alumnus';

    supabase.auth.getSession().then(({ data }) => setWho(classify(data.session?.user.email)));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setWho(classify(session?.user.email));
      // A reset link can land on any page (Supabase falls back to the site URL
      // when the redirect isn't allow-listed). Send it where the form is.
      if (event === 'PASSWORD_RECOVERY' && window.location.pathname !== '/reset-password') {
        router.push('/reset-password');
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  // Close the sheet on navigation, Escape, or a click outside it.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  async function logOut() {
    await supabase.auth.signOut();
    setOpen(false);
    router.push('/');
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const linkClass = (href: string, cta = false) =>
    `nav__link${cta ? ' nav__link--cta' : ''}${isActive(href) ? ' nav__link--active' : ''}`;

  const links = (
    <>
      <Link href="/directory" className={linkClass('/directory')}>Directory</Link>
      <Link href="/colleges" className={linkClass('/colleges')}>Colleges</Link>
      <Link href="/about" className={linkClass('/about')}>About</Link>
      <span className="nav__sep" aria-hidden />
      {who === 'unknown' && <span className="nav__link nav__link--placeholder" aria-hidden />}
      {who === 'guest' && (
        <>
          <Link href="/login" className={linkClass('/login')}>Login</Link>
          <Link href="/register" className={linkClass('/register', true)}>Register</Link>
        </>
      )}
      {(who === 'alumnus' || who === 'admin') && (
        <>
          <Link href={who === 'admin' ? '/admin' : '/profile'} className={linkClass(who === 'admin' ? '/admin' : '/profile', true)}>
            {who === 'admin' ? 'Admin' : 'My profile'}
          </Link>
          <button type="button" className="nav__link nav__link--button" onClick={logOut}>Log out</button>
        </>
      )}
    </>
  );

  return (
    <div className="nav__right" ref={menuRef}>
      <div className="nav__links">{links}</div>
      <button
        type="button"
        className="nav__menu-btn"
        aria-expanded={open}
        aria-controls="nav-sheet"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>{open ? '✕' : '☰'}</span>
      </button>
      {open && <div id="nav-sheet" className="nav__sheet">{links}</div>}
    </div>
  );
}
