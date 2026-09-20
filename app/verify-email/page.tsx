'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Crest from '../../lib/Crest';

/**
 * Where the "confirm this address" link lands.
 *
 * The token is the proof, so this works whether or not the person is signed in
 * on the device that opened their mail — which is usually a phone.
 */
function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('Confirming your address…');

  useEffect(() => {
    if (!token) {
      setState('failed');
      setMessage('That link is missing its code. Open the link from the email again.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const body = (await res.json()) as { ok?: boolean; message?: string; error?: string };
        if (cancelled) return;
        setState(body.ok ? 'done' : 'failed');
        setMessage(body.message ?? body.error ?? 'That link did not work.');
      } catch {
        if (cancelled) return;
        setState('failed');
        setMessage('We could not reach the server. Please try again in a moment.');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="container container--narrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div className="card fade-up" style={{ width: '100%', maxWidth: 440, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><Crest /></div>
        <h1 style={{ fontSize: '1.35rem', margin: '0 0 10px' }}>
          {state === 'done' ? 'Email confirmed' : state === 'failed' ? 'That link did not work' : 'One moment…'}
        </h1>
        <p className="subtitle" style={{ marginBottom: 22 }}>{message}</p>

        {state === 'done' && (
          <Link href="/profile" className="btn btn--primary btn--block">
            <span className="btn__inner">Go to my profile</span>
          </Link>
        )}
        {state === 'failed' && (
          <Link href="/profile" className="btn btn--ghost btn--block">
            <span className="btn__inner">Send a new link from my profile</span>
          </Link>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="container container--narrow" style={{ minHeight: '60vh' }} />}>
      <VerifyEmail />
    </Suspense>
  );
}
