'use client';

import { useEffect, useState } from 'react';

/**
 * Where a claim link lands: /claim?c=<token>.
 *
 * The school started this person's page and sent the link by email or
 * WhatsApp. This asks the server to check it and mint a set-your-password
 * link, then goes there. The token is taken out of the address bar at once,
 * so it is not left in the browser's history.
 */

type State = 'checking' | 'ready' | 'used' | 'expired' | 'invalid' | 'renewed' | 'unavailable';

export default function ClaimPage() {
  const [state, setState] = useState<State>('checking');
  const [token, setToken] = useState('');
  const [canRenew, setCanRenew] = useState(false);
  const [busy, setBusy] = useState(false);

  async function ask(t: string, renew = false) {
    try {
      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: t, renew }),
      });
      const body = (await res.json()) as { state?: State; redirect?: string; canRenew?: boolean };
      if (body.state === 'ready' && body.redirect) {
        setState('ready');
        window.location.assign(body.redirect);
        return;
      }
      setCanRenew(!!body.canRenew);
      setState(body.state ?? 'unavailable');
    } catch {
      setState('unavailable');
    }
  }

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('c') ?? '';
    window.history.replaceState(null, '', '/claim');
    setToken(t);
    if (!t) { setState('invalid'); return; }
    void ask(t);
  }, []);

  const card = (title: string, body: React.ReactNode) => (
    <div className="container container--narrow">
      <div className="card" style={{ textAlign: 'center', padding: '36px 22px' }}>
        <h1 style={{ fontSize: '1.4rem', margin: '0 0 10px' }}>{title}</h1>
        {body}
      </div>
    </div>
  );

  if (state === 'checking' || state === 'ready') {
    return card('Opening your page…', <p className="subtitle"><span className="spinner spinner--neutral" /> One moment — setting up your sign-in.</p>);
  }
  if (state === 'used') {
    return card('This link has been used', (
      <p className="subtitle">
        It works once. <a href="/login">Sign in</a> with the email or phone number the school has for you,
        or <a href="/forgot-password">reset your password</a> if you did not set one.
      </p>
    ));
  }
  if (state === 'expired') {
    return card('This link has expired', (
      <>
        <p className="subtitle">Claim links last two weeks.</p>
        {canRenew ? (
          <button
            type="button" className="btn btn--primary" disabled={busy}
            onClick={async () => { setBusy(true); await ask(token, true); setBusy(false); }}
          >
            <span className="btn__inner">{busy ? 'Sending…' : 'Email me a new link'}</span>
          </button>
        ) : (
          <p className="subtitle">Ask the school office to send you a new one.</p>
        )}
      </>
    ));
  }
  if (state === 'renewed') {
    return card('A new link is on its way', (
      <p className="subtitle">We have sent it to the email the school has for you. It works for two weeks.</p>
    ));
  }
  if (state === 'unavailable') {
    return card('That did not work just now', (
      <p className="subtitle">Please try the link again in a few minutes, or ask the school office.</p>
    ));
  }
  return card('This link does not work', (
    <p className="subtitle">
      Check you opened the whole link from the message. If it still does not work, ask the school office
      for a new one — or <a href="/register">add your journey</a> yourself.
    </p>
  ));
}
