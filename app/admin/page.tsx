'use client';

import React, { useState, useEffect } from 'react';
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
  const [pending, setPending] = useState<AlumniRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    loadPending();
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

  const gradient = 'linear-gradient(135deg, #34d399, #22d3ee, #a78bfa)';

  const pageStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: '#0b0b0f',
    color: '#f4f4f5',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };

  const wrapStyle: React.CSSProperties = {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '48px 20px',
  };

  const cardStyle: React.CSSProperties = {
    background: '#15151b',
    border: '1px solid #26262e',
    borderRadius: '16px',
    padding: '24px',
    marginBottom: '18px',
  };

  const pillButton = (bg: string): React.CSSProperties => ({
    background: bg,
    color: 'white',
    border: 'none',
    padding: '10px 22px',
    borderRadius: '999px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '14px',
  });

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={wrapStyle}>
          <p style={{ color: '#9ca3af' }}>Loading pending submissions...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={wrapStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
            }}
          >
            🎓
          </div>
          <h1 style={{ margin: 0, fontSize: '28px' }}>Admin — Pending Approvals</h1>
        </div>
        <p style={{ color: '#9ca3af', marginTop: '4px', marginBottom: '28px' }}>
          {pending.length} submission{pending.length !== 1 ? 's' : ''} waiting for review.
        </p>

        {actionError && (
          <div style={{ background: '#3a1414', color: '#ff8080', padding: '14px', borderRadius: '12px', marginBottom: '16px' }}>
            {actionError}
          </div>
        )}

        {pending.length === 0 && (
          <div style={{ ...cardStyle, textAlign: 'center', color: '#9ca3af' }}>
            <p style={{ fontSize: '28px', margin: '0 0 8px' }}>🎉</p>
            <p style={{ margin: 0 }}>No pending submissions right now.</p>
          </div>
        )}

        {pending.map((person) => (
          <div key={person.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '18px' }}>{person.full_name}</h3>
                <p style={{ margin: 0, color: '#9ca3af', fontSize: '14px' }}>
                  Admission No: {person.admission_number} &nbsp;|&nbsp; Class of {person.class_of} &nbsp;|&nbsp; {person.stream}
                </p>
              </div>
              {person.photo_url ? (
                <img
                  src={person.photo_url}
                  alt={person.full_name}
                  style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #26262e' }}
                />
              ) : (
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    background: gradient,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                    fontWeight: 700,
                  }}
                >
                  {person.full_name?.charAt(0)}
                </div>
              )}
            </div>

            <div style={{ marginTop: '14px', fontSize: '14px', lineHeight: '1.7', color: '#d4d4d8' }}>
              <p style={{ margin: '4px 0' }}><strong style={{ color: '#f4f4f5' }}>Degree:</strong> {person.degree || '—'} &nbsp; <strong style={{ color: '#f4f4f5' }}>Branch:</strong> {person.branch || '—'} &nbsp; <strong style={{ color: '#f4f4f5' }}>Field:</strong> {person.field || '—'}</p>
              <p style={{ margin: '4px 0' }}><strong style={{ color: '#f4f4f5' }}>Admission Route:</strong> {person.admission_route} {person.admission_rank ? `(Rank: ${person.admission_rank})` : ''}</p>
              <p style={{ margin: '4px 0' }}><strong style={{ color: '#f4f4f5' }}>Current Status:</strong> {person.current_status} — {person.designation || '—'} at {person.currently_at || '—'}</p>
              {person.linkedin_url && (
                <p style={{ margin: '4px 0' }}><strong style={{ color: '#f4f4f5' }}>LinkedIn:</strong> <a href={person.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ color: '#22d3ee' }}>{person.linkedin_url}</a></p>
              )}
              {person.message_1 && <p style={{ margin: '4px 0' }}><strong style={{ color: '#f4f4f5' }}>Msg 1:</strong> {person.message_1}</p>}
              {person.message_2 && <p style={{ margin: '4px 0' }}><strong style={{ color: '#f4f4f5' }}>Msg 2:</strong> {person.message_2}</p>}
              <p style={{ color: '#6b7280', fontSize: '12px', marginTop: '8px' }}>
                Private — Email: {person.personal_email || '—'} | Phone: {person.phone_number || '—'}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button type="button" onClick={() => handleApprove(person.id)} style={pillButton('#16a34a')}>
                Approve
              </button>
              <button type="button" onClick={() => handleReject(person.id)} style={pillButton('#dc2626')}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}