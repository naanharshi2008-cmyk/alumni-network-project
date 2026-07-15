'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

type AlumniRow = {
  id: string;
  full_name: string;
  admission_number: string;
  class_of: number;
  stream: string;
  degree: string | null;
  branch: string | null;
  field: string | null;
  admission_route: string | null;
  admission_rank: string | null;
  current_status: string | null;
  currently_at: string | null;
  designation: string | null;
  linkedin_url: string | null;
  message_1: string | null;
  message_2: string | null;
  personal_email: string | null;
  phone_number: string | null;
  photo_url: string | null;
};

export default function AdminPage() {
  const router = useRouter();
  const [pending, setPending] = useState<AlumniRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [actionError, setActionError] = useState('');

  // Gate the whole page behind a logged-in Supabase session.
  // If nobody is logged in, bounce straight to /login and never
  // touch the pending-submissions data.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/login');
        return;
      }
      setCheckingAuth(false);
      loadPending();
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace('/login');
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  async function loadPending() {
    setLoading(true);
    const { data, error } = await supabase
      .from('alumni')
      .select('*')
      .eq('approval_status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      setActionError('Could not load submissions: ' + error.message);
    } else {
      setPending((data as AlumniRow[]) || []);
    }
    setLoading(false);
  }

  async function handleApprove(id: string) {
    const { error } = await supabase
      .from('alumni')
      .update({ approval_status: 'approved', last_updated: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      setActionError('Could not approve: ' + error.message);
    } else {
      setPending((prev) => prev.filter((p) => p.id !== id));
    }
  }

  async function handleReject(id: string) {
    const reason = prompt('Optional: reason for rejecting (can leave blank)');
    const { error } = await supabase
      .from('alumni')
      .update({ approval_status: 'rejected', rejection_reason: reason || null })
      .eq('id', id);

    if (error) {
      setActionError('Could not reject: ' + error.message);
    } else {
      setPending((prev) => prev.filter((p) => p.id !== id));
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (checkingAuth) {
    return (
      <div className="container">
        <p className="subtitle">Checking login...</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container">
        <p className="subtitle">Loading pending submissions...</p>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="nav__logo">🎓</span>
          <h1 style={{ margin: 0 }}>Admin — Pending Approvals</h1>
        </div>
        <button type="button" onClick={handleLogout} className="btn btn--neutral">
          <span className="btn__inner">Log Out</span>
        </button>
      </div>
      <p className="subtitle" style={{ marginBottom: 28 }}>
        {pending.length} submission{pending.length !== 1 ? 's' : ''} waiting for review.
      </p>

      {actionError && (
        <div style={{
          background: 'var(--danger-bg)',
          border: '1px solid var(--danger-border)',
          color: 'var(--danger-ink)',
          padding: '14px 16px',
          borderRadius: 'var(--r-sm)',
          marginBottom: 18,
        }}>
          {actionError}
        </div>
      )}

      {pending.length === 0 && (
        <div className="card empty">
          <span className="empty__emoji">🎉</span>
          <p style={{ margin: 0 }}>No pending submissions right now.</p>
        </div>
      )}

      <div className="stagger">
        {pending.map((person) => (
          <div key={person.id} className="card" style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem' }}>{person.full_name}</h3>
                <p className="subtitle" style={{ margin: 0, fontSize: '0.86rem' }}>
                  Admission No: {person.admission_number} &nbsp;|&nbsp; Class of {person.class_of} &nbsp;|&nbsp; {person.stream}
                </p>
              </div>
              <div className="avatar">
                {person.photo_url ? (
                  <img src={person.photo_url} alt={person.full_name} />
                ) : (
                  person.full_name?.charAt(0)
                )}
              </div>
            </div>

            <div className="a-card__rows" style={{ marginTop: 14 }}>
              <p className="a-row" style={{ margin: '4px 0' }}>
                <strong>Degree:</strong>&nbsp;{person.degree || '—'} &nbsp; <strong>Branch:</strong>&nbsp;{person.branch || '—'} &nbsp; <strong>Field:</strong>&nbsp;{person.field || '—'}
              </p>
              <p className="a-row" style={{ margin: '4px 0' }}>
                <strong>Admission Route:</strong>&nbsp;{person.admission_route} {person.admission_rank ? `(Rank: ${person.admission_rank})` : ''}
              </p>
              <p className="a-row" style={{ margin: '4px 0' }}>
                <strong>Current Status:</strong>&nbsp;{person.current_status} — {person.designation || '—'} at {person.currently_at || '—'}
              </p>
              {person.linkedin_url && (
                <p className="a-row" style={{ margin: '4px 0' }}>
                  <strong>LinkedIn:</strong>&nbsp;<a href={person.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>{person.linkedin_url}</a>
                </p>
              )}
              {person.message_1 && <p className="a-row" style={{ margin: '4px 0' }}><strong>Msg 1:</strong>&nbsp;{person.message_1}</p>}
              {person.message_2 && <p className="a-row" style={{ margin: '4px 0' }}><strong>Msg 2:</strong>&nbsp;{person.message_2}</p>}
              <p style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginTop: 8 }}>
                Private — Email: {person.personal_email || '—'} | Phone: {person.phone_number || '—'}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button type="button" onClick={() => handleApprove(person.id)} className="btn btn--primary">
                <span className="btn__inner">Approve</span>
              </button>
              <button type="button" onClick={() => handleReject(person.id)} className="btn btn--neutral">
                <span className="btn__inner">Reject</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}