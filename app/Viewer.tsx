'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

/**
 * Who is reading the page, asked once.
 *
 * The header and the footer both need this, and they used to be two different
 * answers: the header subscribed to auth changes, and the footer did not know
 * about them at all - so a signed-in alumnus was still invited to "Sign in".
 * One subscription, one answer, shared.
 *
 * 'unknown' is a real state, not a loading detail: rendering Login/Register
 * before the session resolves makes them flash for a signed-in visitor on
 * every page load.
 */

export type Who = 'unknown' | 'guest' | 'alumnus' | 'admin';

const ADMIN_DOMAIN = '@veveaham-admin.local';

const ViewerContext = createContext<Who>('unknown');

export function useViewer() {
  return useContext(ViewerContext);
}

export default function ViewerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [who, setWho] = useState<Who>('unknown');

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
  }, [router, pathname]);

  return <ViewerContext.Provider value={who}>{children}</ViewerContext.Provider>;
}
