'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import Crest from '../../lib/Crest';

const ADMIN_LOGIN_DOMAIN = 'veveaham-admin.local';

const NO_MATCH = "That email or phone number and password don't match.";

/** Phone-shaped: digits with optional spaces, dashes, brackets or a leading +. */
function looksLikePhone(value: string): boolean {
  return /^[+\d\s()-]+$/.test(value) && value.replace(/\D/g, '').length >= 7;
}

/**
 * Turn what someone typed into the address Supabase actually signs in with.
 *
 * Alumni accounts use an opaque internal address, so an email or phone number
 * is looked up with the login_handle RPC, which returns only that handle -
 * never anyone's contact details. Signing in itself stays in the browser, so
 * Supabase's rate limits apply per visitor rather than to the whole site.
 *
 * Staff accounts keep their short name ("staff"), which alumni no longer have.
 */
async function resolveLoginEmail(input: string): Promise<string | null> {
  const lower = input.toLowerCase();
  if (lower.endsWith(`@${ADMIN_LOGIN_DOMAIN}`)) return lower;

  if (input.includes('@') || looksLikePhone(input)) {
    const { data, error } = await supabase.rpc('login_handle', { p_identifier: input });
    if (error) throw new Error('Sign-in is unavailable right now. Please try again in a minute.');
    return (data as string | null) ?? null;
  }

  if (/^[a-z0-9._-]{2,40}$/i.test(input)) return `${lower}@${ADMIN_LOGIN_DOMAIN}`;
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const input = identifier.trim();
    if (!input || !password) {
      setError('Enter your email or phone number, and your password.');
      return;
    }
    setLoading(true);

    try {
      const email = await resolveLoginEmail(input);
      if (!email) throw new Error(NO_MATCH);

      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError || !data.user) throw new Error(NO_MATCH);

      // An admin-issued temporary password has to be replaced first.
      if (data.user.app_metadata?.must_change_password) {
        router.push('/reset-password?forced=1');
        return;
      }
      router.push(data.user.email?.endsWith(`@${ADMIN_LOGIN_DOMAIN}`) ? '/admin' : '/profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : NO_MATCH);
      setLoading(false);
    }
  }

  return (
    <div className="container container--narrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div className="card fade-up" style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <Crest />
          <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Welcome back</h1>
        </div>
        <p className="subtitle" style={{ marginBottom: 24 }}>
          Sign in with the email or phone number you registered with.
        </p>

        {error && <div className="alert alert--error" role="alert">{error}</div>}

        <form onSubmit={handleLogin} noValidate>
          <div className="field">
            <label htmlFor="identifier">Email or phone number</label>
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@example.com or 98765 43210"
            />
          </div>

          <div className="field">
            <div className="login-label-row">
              <label htmlFor="password">Password</label>
              <Link href="/forgot-password" className="login-forgot">Forgot password?</Link>
            </div>
            <div className="password-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn btn--primary btn--block btn--lg">
            <span className="btn__inner">{loading ? <span className="spinner" /> : 'Sign in'}</span>
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          New here? <Link href="/register" style={{ color: 'var(--gold)', fontWeight: 600 }}>Add your journey →</Link>
        </div>
      </div>
    </div>
  );
}
