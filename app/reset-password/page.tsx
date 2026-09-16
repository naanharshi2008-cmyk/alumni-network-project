'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import Crest from '../../lib/Crest';

const MIN_LENGTH = 8;

/**
 * Two ways in, one form:
 *  - from the emailed link: Supabase puts a recovery session in the URL, which
 *    the client picks up on load;
 *  - ?forced=1: signed in with a temporary password an admin issued.
 * Either way there is a session, and updateUser sets the new password.
 */
function ResetPasswordForm() {
  const router = useRouter();
  const forced = useSearchParams().get('forced') === '1';
  const [ready, setReady] = useState<'checking' | 'ok' | 'no-session'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let settled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) { settled = true; setReady('ok'); }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) { settled = true; setReady('ok'); }
    });
    // The recovery token in the URL is exchanged asynchronously; give it a moment.
    const t = setTimeout(() => { if (!settled) setReady('no-session'); }, 2500);
    return () => { sub.subscription.unsubscribe(); clearTimeout(t); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < MIN_LENGTH) { setError(`Use at least ${MIN_LENGTH} characters.`); return; }
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setSaving(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setError(/different from the old/i.test(updErr.message)
        ? 'Choose a password different from your current one.'
        : 'Could not save the new password. The link may have expired — request a new one.');
      setSaving(false);
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      await fetch('/api/auth/password-changed', {
        method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}` },
      }).catch(() => undefined);
    }
    const isAdmin = data.session?.user.email?.endsWith('@veveaham-admin.local');
    router.replace(isAdmin ? '/admin' : '/profile?password=updated');
  }

  return (
    <div className="container container--narrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div className="card fade-up" style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <Crest />
          <h1 style={{ fontSize: '1.4rem', margin: 0 }}>{forced ? 'Choose your own password' : 'Set a new password'}</h1>
        </div>

        {ready === 'checking' && <p className="subtitle">Checking your link…</p>}

        {ready === 'no-session' && (
          <>
            <div className="alert alert--error" role="alert" style={{ marginTop: 16 }}>
              This link has expired or was already used.
            </div>
            <Link href="/forgot-password" className="btn btn--primary btn--block">
              <span className="btn__inner">Request a new link</span>
            </Link>
          </>
        )}

        {ready === 'ok' && (
          <>
            <p className="subtitle" style={{ marginBottom: 22 }}>
              {forced
                ? 'You signed in with a temporary password from the school. Replace it with one only you know.'
                : `Use at least ${MIN_LENGTH} characters.`}
            </p>
            {error && <div className="alert alert--error" role="alert">{error}</div>}
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="new-password">New password</label>
                <div className="password-wrap">
                  <input id="new-password" type={show ? 'text' : 'password'} autoComplete="new-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="password-toggle" onClick={() => setShow((v) => !v)}
                    aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                    {show ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="confirm-password">Type it again</label>
                <input id="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <button type="submit" disabled={saving} className="btn btn--primary btn--block btn--lg">
                <span className="btn__inner">{saving ? <span className="spinner" /> : 'Save password'}</span>
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
