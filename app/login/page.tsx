'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// Teachers log in with a plain username + shared password - no email signup,
// no per-teacher accounts. Under the hood Supabase Auth still needs an
// email-shaped identifier, so we silently attach a fixed fake domain to
// whatever username is typed. Teachers never see or type an "email".
const ADMIN_LOGIN_DOMAIN = 'veveaham-admin.local';

function usernameToEmail(username: string) {
  const trimmed = username.trim();
  return trimmed.includes('@') ? trimmed : `${trimmed}@${ADMIN_LOGIN_DOMAIN}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });

    setLoading(false);

    if (signInError) {
      setError('Incorrect username or password.');
      return;
    }

    router.push('/admin');
  }

  return (
    <div className="container container--narrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div className="card fade-up" style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <span className="nav__logo">🎓</span>
          <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Staff Login</h1>
        </div>
        <p className="subtitle" style={{ marginBottom: 24 }}>
          Sign in to review pending alumni submissions.
        </p>

        {error && (
          <div style={{
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger-border)',
            color: 'var(--danger-ink)',
            padding: '12px 15px',
            borderRadius: 'var(--r-sm)',
            marginBottom: 18,
            fontSize: '0.88rem',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={loading} className="btn btn--primary btn--block btn--lg">
            <span className="btn__inner">{loading ? <span className="spinner" /> : 'Sign In'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}