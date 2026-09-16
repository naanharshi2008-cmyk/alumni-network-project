'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Crest from '../../lib/Crest';

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const value = identifier.trim();
    if (!value) { setError('Enter the email or phone number you registered with.'); return; }
    setState('sending');
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Something went wrong. Please try again.');
      setMessage(body.message);
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setState('idle');
    }
  }

  return (
    <div className="container container--narrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div className="card fade-up" style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <Crest />
          <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Forgot your password?</h1>
        </div>

        {state === 'sent' ? (
          <>
            <div className="alert alert--success" role="status" style={{ marginTop: 16 }}>{message}</div>
            <p className="subtitle" style={{ fontSize: '0.9rem' }}>
              The link works once and expires in an hour. Check your spam folder too.
              Nothing within 10 minutes? Ask the school office to reset it for you.
            </p>
            <Link href="/login" className="btn btn--ghost btn--block" style={{ marginTop: 8 }}>
              <span className="btn__inner">Back to sign in</span>
            </Link>
          </>
        ) : (
          <>
            <p className="subtitle" style={{ marginBottom: 22 }}>
              Enter the email or phone number you registered with. We&apos;ll email you a link to choose a new password.
            </p>
            {error && <div className="alert alert--error" role="alert">{error}</div>}
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="identifier">Email or phone number</label>
                <input
                  id="identifier" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false}
                  value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@example.com or 98765 43210"
                />
              </div>
              <button type="submit" disabled={state === 'sending'} className="btn btn--primary btn--block btn--lg">
                <span className="btn__inner">{state === 'sending' ? <span className="spinner" /> : 'Send reset link'}</span>
              </button>
            </form>
            <p style={{ textAlign: 'center', marginTop: 18, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
              Remembered it? <Link href="/login" style={{ color: 'var(--gold)', fontWeight: 600 }}>Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
