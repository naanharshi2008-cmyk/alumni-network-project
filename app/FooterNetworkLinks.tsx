'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useViewer } from './Viewer';

/**
 * The footer's second column, which depends on who is reading.
 *
 * It used to offer "Add your journey" and "Sign in" to everybody, including
 * people who were already signed in and already had a profile - and it never
 * offered a way to that profile.
 */
export default function FooterNetworkLinks() {
  const router = useRouter();
  const who = useViewer();

  async function logOut() {
    await supabase.auth.signOut();
    router.push('/');
  }

  return (
    <>
      <Link href="/about">About</Link>
      {who === 'unknown' && <span className="footer__placeholder" aria-hidden />}
      {who === 'guest' && (
        <>
          <Link href="/register">Add your journey</Link>
          <Link href="/login">Sign in</Link>
        </>
      )}
      {(who === 'alumnus' || who === 'admin') && (
        <>
          <Link href={who === 'admin' ? '/admin' : '/profile'}>
            {who === 'admin' ? 'Admin dashboard' : 'My profile'}
          </Link>
          <button type="button" className="footer__link-button" onClick={logOut}>Log out</button>
        </>
      )}
    </>
  );
}
