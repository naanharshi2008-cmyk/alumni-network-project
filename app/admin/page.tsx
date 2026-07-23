'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

type AlumniRow = {
  id: string;
  full_name: string;
  username: string | null;
  admission_number: string | null;
  school_name: string | null;
  class_of: number;
  stream: string;
  school_board: string | null;
  degree: string | null;
  branch: string | null;
  field: string | null;
  admission_route: string | null;
  admission_rank: string | null;
  board_marks: string | null;
  board_cutoff: string | null;
  current_status: string | null;
  currently_at: string | null;
  designation: string | null;
  linkedin_url: string | null;
  message_1: string | null;
  message_2: string | null;
  personal_email: string | null;
  phone_number: string | null;
  phone_country_code: string | null;
  photo_url: string | null;
  approval_status: string;
  modification_status: string | null;
  original_data: Record<string, any> | null;
  created_at: string;
};

type Tab = 'registrations' | 'edits';

const FIELD_LABELS: Record<string, string> = {
  full_name: 'Full Name', school_name: 'School', class_of: 'Class Of',
  stream: 'Stream', degree: 'Degree', branch: 'Branch', field: 'Field',
  currently_at: 'Currently At', designation: 'Designation',
  current_status: 'Status', admission_route: 'Admission Route',
  admission_rank: 'Rank', board_marks: 'Board Marks', board_cutoff: 'Cutoff',
  message_1: 'Advice', linkedin_url: 'LinkedIn',
};// The fixed options the registration form ships with, per field. Anything a
// pending person submitted that ISN'T in this list (and hasn't already been
// promoted via field_options) is a free-typed "Other" value, so we show a
// button next to it letting staff turn it into a real option going forward.
const KNOWN_VALUES: Record<string, string[]> = {
  stream: ['Bio-Maths', 'CS-Maths', 'Commerce (Business & Finance)', 'Other'],
  degree: ['BTech', 'BE', 'BSc', 'MBBS', 'BCom', 'BA', 'BArch', 'LLB', 'BBA', 'BCA', 'Other'],
  admission_route: [
    'JEE Main', 'JEE Advanced', 'NEET', 'CUET', 'BITSAT', 'VITEEE', 'SRMJEEE',
    'COMEDK', 'KCET', 'MHT-CET', 'WBJEE', 'KEAM', 'CLAT', 'Other', 'Board Marks', 'Direct',
  ],
  current_status: ['Studying UG', 'Studying PG', 'Higher Studies', 'Working', 'Entrepreneur', 'Preparing', 'On Break', 'Other'],
};

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('registrations');
  const [pending, setPending] = useState<AlumniRow[]>([]);
  const [pendingEdits, setPendingEdits] = useState<AlumniRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setCheckingAuth(false);
      loadAll();
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login');
    });
    return () => { listener.subscription.unsubscribe(); };
  }, []);

  async function loadAll() {
    setLoading(true);
    const [regRes, editRes] = await Promise.all([
      supabase.from('alumni').select('*').eq('approval_status', 'pending').order('created_at', { ascending: true }),
      supabase.from('alumni').select('*').eq('approval_status', 'approved').eq('modification_status', 'pending').order('created_at', { ascending: true }),
    ]);
    if (regRes.error) setActionError('Could not load registrations: ' + regRes.error.message);
    else setPending((regRes.data as AlumniRow[]) || []);
    if (editRes.data) setPendingEdits((editRes.data as AlumniRow[]) || []);
    setLoading(false);
  }

  async function handleApprove(id: string) {
    setActionError('');
    const person = pending.find(p => p.id === id);
    const { error } = await supabase
      .from('alumni')
      .update({ approval_status: 'approved', original_data: person || null })
      .eq('id', id);
    if (error) { setActionError('Could not approve: ' + error.message); return; }
    setPending(prev => prev.filter(p => p.id !== id));
  }

  async function handleReject(id: string) {
    setActionError('');
    const reason = prompt('Optional: reason for rejecting (can leave blank)');
    const { error } = await supabase
      .from('alumni')
      .update({ approval_status: 'rejected', rejection_reason: reason || null })
      .eq('id', id);
    if (error) { setActionError('Could not reject: ' + error.message); return; }
    setPending(prev => prev.filter(p => p.id !== id));
  }

  async function handleApproveEdit(id: string) {
    setActionError('');
    // Snapshot the current (new) data into original_data
    const person = pendingEdits.find(p => p.id === id);
    const snapshot = person ? { ...person } : null;
    const { error } = await supabase
      .from('alumni')
      .update({ modification_status: 'approved', original_data: snapshot })
      .eq('id', id);
    if (error) { setActionError('Could not approve edits: ' + error.message); return; }
    setPendingEdits(prev => prev.filter(p => p.id !== id));
  }

  async function handleRevertEdit(id: string) {
    setActionError('');
    const person = pendingEdits.find(p => p.id === id);
    if (!person || !person.original_data) {
      setActionError('No original version to revert to for this person.');
      return;
    }
    // Restore the original_data fields back to the live columns
    const orig = person.original_data;
    const { error } = await supabase
      .from('alumni')
      .update({
        full_name: orig.full_name,
        school_name: orig.school_name,
        class_of: orig.class_of,
        stream: orig.stream,
        school_board: orig.school_board,
        degree: orig.degree,
        branch: orig.branch,
        field: orig.field,
        college_id: orig.college_id,
        admission_route: orig.admission_route,
        admission_rank: orig.admission_rank,
        board_marks: orig.board_marks,
        board_cutoff: orig.board_cutoff,
        current_status: orig.current_status,
        expected_finish_year: orig.expected_finish_year,
        currently_at: orig.currently_at,
        designation: orig.designation,
        linkedin_url: orig.linkedin_url,
        message_1: orig.message_1,
        photo_url: orig.photo_url,
        modification_status: 'reverted',
      })
      .eq('id', id);
    if (error) { setActionError('Could not revert: ' + error.message); return; }
    setPendingEdits(prev => prev.filter(p => p.id !== id));
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (checkingAuth) return <div className="container"><p className="subtitle">Checking login…</p></div>;
  if (loading) return <div className="container"><p className="subtitle">Loading submissions…</p></div>;

  return (
    <div className="container">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="nav__logo">🎓</span>
          <h1 style={{ margin: 0 }}>Admin Dashboard</h1>
        </div>
        <button type="button" onClick={handleLogout} className="btn btn--neutral">
          <span className="btn__inner">Log Out</span>
        </button>
      </div>

      {/* Tab switcher */}
      <div className="chips" style={{ marginBottom: 28 }}>
        <button
          type="button"
          className={`chip${tab === 'registrations' ? ' chip--active' : ''}`}
          onClick={() => setTab('registrations')}
        >
          📋 New Registrations
          <span style={{ opacity: 0.7, marginLeft: 6 }}>{pending.length}</span>
        </button>
        <button
          type="button"
          className={`chip${tab === 'edits' ? ' chip--active' : ''}`}
          onClick={() => setTab('edits')}
        >
          ✏️ Pending Edits
          <span style={{ opacity: 0.7, marginLeft: 6 }}>{pendingEdits.length}</span>
        </button>
      </div>

      {actionError && (
        <div style={{
          background: 'var(--danger-bg)', border: '1px solid var(--danger-border)',
          color: 'var(--danger-ink)', padding: '14px 16px',
          borderRadius: 'var(--r-sm)', marginBottom: 18,
        }}>
          {actionError}
        </div>
      )}

      {/* ===== Tab: New Registrations ===== */}
      {tab === 'registrations' && (
        <div className="stagger">
          {pending.length === 0 ? (
            <div className="card empty">
              <span className="empty__emoji">🎉</span>
              <p style={{ margin: 0 }}>No pending registrations right now.</p>
            </div>
          ) : (
            pending.map((person) => (
              <div key={person.id} className="card" style={{ marginBottom: 18 }}>
                <PersonHeader person={person} />
                <PersonDetails person={person} />
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <button type="button" onClick={() => handleApprove(person.id)} className="btn btn--primary">
                    <span className="btn__inner">✓ Approve</span>
                  </button>
                  <button type="button" onClick={() => handleReject(person.id)} className="btn btn--neutral">
                    <span className="btn__inner">✕ Reject</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===== Tab: Pending Profile Edits ===== */}
      {tab === 'edits' && (
        <div className="stagger">
          {pendingEdits.length === 0 ? (
            <div className="card empty">
              <span className="empty__emoji">✨</span>
              <p style={{ margin: 0 }}>No profile edits waiting for review.</p>
            </div>
          ) : (
            pendingEdits.map((person) => (
              <div key={person.id} className="card" style={{ marginBottom: 24 }}>
                <PersonHeader person={person} />

                {/* Side-by-side diff */}
                {person.original_data && (
                  <div style={{ marginTop: 16 }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 10, fontWeight: 600 }}>
                      Changed fields — left is approved version, right is new version:
                    </p>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 10,
                    }}>
                      {/* Old (approved) */}
                      <div style={{
                        background: 'rgba(239,68,68,0.07)',
                        border: '1px solid rgba(239,68,68,0.25)',
                        borderRadius: 'var(--r-sm)',
                        padding: '12px 14px',
                      }}>
                        <p style={{ margin: '0 0 8px 0', fontWeight: 700, fontSize: '0.8rem', color: '#fca5a5', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          Approved version
                        </p>
                        {Object.keys(FIELD_LABELS).map(key => {
                          const oldVal = person.original_data![key];
                          const newVal = (person as any)[key];
                          if (oldVal === newVal || (!oldVal && !newVal)) return null;
                          return (
                            <div key={key} style={{ marginBottom: 6 }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', display: 'block' }}>{FIELD_LABELS[key]}</span>
                              <span style={{ fontSize: '0.9rem', color: '#fca5a5' }}>{oldVal || '—'}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* New (pending) */}
                      <div style={{
                        background: 'rgba(52,211,153,0.07)',
                        border: '1px solid rgba(52,211,153,0.25)',
                        borderRadius: 'var(--r-sm)',
                        padding: '12px 14px',
                      }}>
                        <p style={{ margin: '0 0 8px 0', fontWeight: 700, fontSize: '0.8rem', color: 'var(--emerald)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          New version
                        </p>
                        {Object.keys(FIELD_LABELS).map(key => {
                          const oldVal = person.original_data![key];
                          const newVal = (person as any)[key];
                          if (oldVal === newVal || (!oldVal && !newVal)) return null;
                          return (
                            <div key={key} style={{ marginBottom: 6 }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', display: 'block' }}>{FIELD_LABELS[key]}</span>
                              <span style={{ fontSize: '0.9rem', color: 'var(--emerald)' }}>{newVal || '—'}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Private contact */}
                <p style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginTop: 12 }}>
                  Private — Email: {person.personal_email || '—'} | Phone: {person.phone_country_code}{person.phone_number || '—'}
                </p>

                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button type="button" onClick={() => handleApproveEdit(person.id)} className="btn btn--primary">
                    <span className="btn__inner">✓ Approve Changes</span>
                  </button>
                  <button type="button" onClick={() => handleRevertEdit(person.id)} className="btn btn--neutral">
                    <span className="btn__inner">↩ Revert to Approved</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ----- Shared sub-components --------------------------------------------- */

function PersonHeader({ person }: { person: AlumniRow }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
      <div>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem' }}>{person.full_name}</h3>
        <p className="subtitle" style={{ margin: 0, fontSize: '0.86rem' }}>
          {person.username && <><strong>@{person.username}</strong> · </>}
          Class of {person.class_of} · {person.stream}
          {person.school_name && <> · {person.school_name}</>}
        </p>
      </div>
      <div className="avatar">
        {person.photo_url
          ? <img src={person.photo_url} alt={person.full_name} />
          : person.full_name?.charAt(0)}
      </div>
    </div>
  );
}

function PersonDetails({ person }: { person: AlumniRow }) {
  return (
    <div className="a-card__rows" style={{ marginTop: 14 }}>
      <p className="a-row" style={{ margin: '4px 0' }}>
        <strong>Degree:</strong>&nbsp;{person.degree || '—'}&nbsp;&nbsp;
        <strong>Branch:</strong>&nbsp;{person.branch || '—'}&nbsp;&nbsp;
        <strong>Field:</strong>&nbsp;{person.field || '—'}
      </p>
      <p className="a-row" style={{ margin: '4px 0' }}>
        <strong>Admission:</strong>&nbsp;{person.admission_route}
        {person.admission_rank ? ` (Rank: ${person.admission_rank})` : ''}
        {person.board_marks ? ` (${person.board_marks}%)` : ''}
      </p>
      <p className="a-row" style={{ margin: '4px 0' }}>
        <strong>Status:</strong>&nbsp;{person.current_status}
        {person.currently_at ? ` — ${person.designation || ''} at ${person.currently_at}` : ''}
      </p>
      {person.linkedin_url && (
        <p className="a-row" style={{ margin: '4px 0' }}>
          <strong>LinkedIn:</strong>&nbsp;
          <a href={person.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
            {person.linkedin_url}
          </a>
        </p>
      )}
      {person.message_1 && <p className="a-row" style={{ margin: '4px 0', fontStyle: 'italic', color: 'var(--text-muted)' }}>"{person.message_1}"</p>}
      <p style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginTop: 8 }}>
        Private — Email: {person.personal_email || '—'} | Phone: {person.phone_country_code}{person.phone_number || '—'}
      </p>
    </div>
  );
}