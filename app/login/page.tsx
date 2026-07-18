'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

const ADMIN_LOGIN_DOMAIN = 'veveaham-admin.local';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState(''); // Username or Email
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const input = identifier.trim();
    let emailToAuth = '';

    try {
      if (input.includes('@')) {
        // It's already an email
        emailToAuth = input;
      } else {
        // It's a username. Let's check if it's an alumnus username first.
        const { data: alum, error: alumErr } = await supabase
          .from('alumni')
          .select('personal_email')
          .eq('username', input)
          .maybeSingle();

        if (alum && alum.personal_email) {
          emailToAuth = alum.personal_email;
        } else {
          // If not an alumnus username, assume it might be a staff username
          emailToAuth = `${input}@${ADMIN_LOGIN_DOMAIN}`;
        }
      }

      // Log in via Supabase Auth
      const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
        email: emailToAuth,
        password,
      });

      if (signInError) {
        throw new Error('Incorrect username, email, or password.');
      }

      const user = authData.user;
      
      if (user && user.email && user.email.endsWith(`@${ADMIN_LOGIN_DOMAIN}`)) {
        // Staff/Admin redirects to `/admin`
        router.push('/admin');
      } else {
        // Alumni redirects to `/profile`
        router.push('/profile');
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Incorrect login details.');
      setLoading(false);
    }
  }

  return (
    <div className="container container--narrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div className="card fade-up" style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <span className="nav__logo">🎓</span>
          <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Alumni & Staff Login</h1>
        </div>
        <p className="subtitle" style={{ marginBottom: 24 }}>
          Sign in to manage your profile or review submissions.
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
            <label htmlFor="identifier">Username or Email</label>
            <input
              id="identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="e.g. johndoe or email@domain.com"
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
        
        <div style={{ textAlign: 'center', marginTop: 18, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Don't have an account? <a href="/register" style={{ color: 'var(--gold)', fontWeight: 600 }}>Register here →</a>
        </div>
      </div>
    </div>
  );
}