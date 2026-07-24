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
  college_name_raw: string | null;
  college_id: string | null;
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

type Tab = 'registrations' | 'edits' | 'colleges' | 'tags';

type HigherStudyRow = {
  id: string;
  alumni_id: string;
  degree_name: string;
  institution: string | null;
  start_year: number | null;
  finish_year: number | null;
};

type WorkExperienceRow = {
  id: string;
  alumni_id: string;
  company: string;
  role: string | null;
  start_year: number | null;
  end_year: number | null;
  is_current: boolean;
};

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
// Friendly section headers for the "Manage Tags" tab.
const TAG_CATEGORY_LABELS: Record<string, string> = {
  stream: 'Stream',
  degree: 'Degree',
  admission_route: 'Entrance Exam',
  current_status: 'Current Status',
};
export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('registrations');
  const [pending, setPending] = useState<AlumniRow[]>([]);
  const [pendingEdits, setPendingEdits] = useState<AlumniRow[]>([]);
  const [higherStudiesMap, setHigherStudiesMap] = useState<Record<string, HigherStudyRow[]>>({});
  const [workExperienceMap, setWorkExperienceMap] = useState<Record<string, WorkExperienceRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [actionError, setActionError] = useState('');
  // Values already promoted to real options via field_options, grouped by
  // category - used to hide the "+ Add as option" button once something's
  // already been added, without needing a full page refresh.
  const [existingTags, setExistingTags] = useState<Record<string, Set<string>>>({});

  function markTagAdded(category: string, value: string) {
    setExistingTags((prev) => {
      const next = { ...prev };
      next[category] = new Set(next[category] ? [...next[category], value] : [value]);
      return next;
    });
  }
  function removeTagLocally(category: string, value: string) {
    setExistingTags((prev) => {
      const next = { ...prev };
      if (next[category]) {
        const updated = new Set(next[category]);
        updated.delete(value);
        next[category] = updated;
      }
      return next;
    });
  }

  async function loadExistingTags() {
    const { data } = await supabase.from('field_options').select('category, value');
    if (data) {
      const grouped: Record<string, Set<string>> = {};
      for (const row of data as { category: string; value: string }[]) {
        if (!grouped[row.category]) grouped[row.category] = new Set();
        grouped[row.category].add(row.value);
      }
      setExistingTags(grouped);
    }
  }
  const [unmatchedColleges, setUnmatchedColleges] = useState<{ key: string; display: string; alumniIds: string[] }[]>([]);

  async function loadUnmatchedColleges() {
    const { data } = await supabase
      .from('alumni')
      .select('id, college_name_raw')
      .is('college_id', null)
      .not('college_name_raw', 'is', null);
    if (data) {
      const groups: Record<string, { display: string; alumniIds: string[] }> = {};
      for (const row of data as { id: string; college_name_raw: string }[]) {
        const key = (row.college_name_raw || '').trim().toLowerCase();
        if (!key) continue;
        if (!groups[key]) groups[key] = { display: row.college_name_raw.trim(), alumniIds: [] };
        groups[key].alumniIds.push(row.id);
      }
      const list = Object.entries(groups).map(([key, v]) => ({ key, display: v.display, alumniIds: v.alumniIds }));
      list.sort((a, b) => b.alumniIds.length - a.alumniIds.length);
      setUnmatchedColleges(list);
    }
  }

  function removeResolvedGroup(key: string) {
    setUnmatchedColleges((prev) => prev.filter((g) => g.key !== key));
  }
  const [adminColleges, setAdminColleges] = useState<{ id: string; name: string; state: string | null }[]>([]);

  async function loadAdminColleges() {
    const { data } = await supabase
      .from('colleges')
      .select('id, name, state')
      .eq('added_by_admin', true)
      .order('name');
    if (data) setAdminColleges(data);
  }

  function removeAdminCollegeLocally(id: string) {
    setAdminColleges((prev) => prev.filter((c) => c.id !== id));
  }
  

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setCheckingAuth(false);
      loadAll();
      loadExistingTags();
      loadUnmatchedColleges();
      loadAdminColleges();
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

    const allIds = [
      ...((regRes.data as AlumniRow[]) || []),
      ...((editRes.data as AlumniRow[]) || []),
    ].map((p) => p.id);
    if (allIds.length) {
      const [studiesRes, workRes] = await Promise.all([
        supabase.from('higher_studies').select('*').in('alumni_id', allIds),
        supabase.from('work_experience').select('*').in('alumni_id', allIds),
      ]);
      if (studiesRes.data) {
        const grouped: Record<string, HigherStudyRow[]> = {};
        for (const row of studiesRes.data as HigherStudyRow[]) {
          (grouped[row.alumni_id] ??= []).push(row);
        }
        setHigherStudiesMap(grouped);
      }
      if (workRes.data) {
        const grouped: Record<string, WorkExperienceRow[]> = {};
        for (const row of workRes.data as WorkExperienceRow[]) {
          (grouped[row.alumni_id] ??= []).push(row);
        }
        setWorkExperienceMap(grouped);
      }
    }
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
        <button
          type="button"
          className={`chip${tab === 'colleges' ? ' chip--active' : ''}`}
          onClick={() => setTab('colleges')}
        >
          🏫 Unmatched Colleges
          <span style={{ opacity: 0.7, marginLeft: 6 }}>{unmatchedColleges.length}</span>
        </button>
        <button
          type="button"
          className={`chip${tab === 'tags' ? ' chip--active' : ''}`}
          onClick={() => setTab('tags')}
        >
          🏷 Manage Tags
          <span style={{ opacity: 0.7, marginLeft: 6 }}>
            {Object.values(existingTags).reduce((sum, s) => sum + s.size, 0)}
          </span>
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
                <PersonHeader person={person} existingTags={existingTags} onTagAdded={markTagAdded} />
                <PersonDetails
                  person={person}
                  existingTags={existingTags}
                  onTagAdded={markTagAdded}
                  higherStudies={higherStudiesMap[person.id]}
                  workExperience={workExperienceMap[person.id]}
                  
                />
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

      {/* ===== Tab: Unmatched Colleges ===== */}
      {tab === 'colleges' && (
        <div className="stagger">
          {unmatchedColleges.length === 0 ? (
            <div className="card empty">
              <span className="empty__emoji">🏫</span>
              <p style={{ margin: 0 }}>No unmatched colleges right now - nice and tidy.</p>
            </div>
          ) : (
            unmatchedColleges.map((group) => (
              <UnmatchedCollegeRow
                key={group.key}
                groupKey={group.key}
                display={group.display}
                alumniIds={group.alumniIds}
                onResolved={removeResolvedGroup}
              />
            ))
          )}
</div>
      )}

      {/* ===== Tab: Manage Tags ===== */}
      {tab === 'tags' && (
        <div className="stagger">
          {Object.entries(existingTags).every(([, values]) => values.size === 0) ? (
            <div className="card empty">
              <span className="empty__emoji">🏷</span>
              <p style={{ margin: 0 }}>No admin-added tags yet.</p>
            </div>
          ) : (
            Object.entries(TAG_CATEGORY_LABELS).map(([category, label]) => {
              const values = Array.from(existingTags[category] ?? []).sort();
              if (values.length === 0) return null;
              return (
                <div key={category} className="card" style={{ marginBottom: 18, padding: '16px 20px' }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>{label}</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {values.map((value) => (
                      <TagDeleteChip
                        key={value}
                        category={category}
                        value={value}
                        onDeleted={() => removeTagLocally(category, value)}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
)}

          {adminColleges.length > 0 && (
            <div className="card" style={{ marginBottom: 18, padding: '16px 20px' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>Colleges (Admin-Added)</h3>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.82rem', color: 'var(--text-faint)' }}>
                Only colleges added through this admin panel show up here - the original bulk-imported list isn't editable from this screen.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {adminColleges.map((c) => (
                  <CollegeDeleteRow key={c.id} id={c.id} name={c.name} onDeleted={() => removeAdminCollegeLocally(c.id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ----- Shared sub-components --------------------------------------------- */

function PersonHeader({
  person, existingTags, onTagAdded,
}: {
  person: AlumniRow;
  existingTags?: Record<string, Set<string>>;
  onTagAdded?: (category: string, value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
      <div>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem' }}>{person.full_name}</h3>
        <p className="subtitle" style={{ margin: 0, fontSize: '0.86rem' }}>
          {person.username && <><strong>@{person.username}</strong> · </>}
          Class of {person.class_of} · {person.stream}
          {onTagAdded && existingTags && (
            <AddTagButton category="stream" value={person.stream} existingTags={existingTags} onAdded={onTagAdded} />
          )}
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
function PersonDetails({
  person, existingTags, onTagAdded, higherStudies, workExperience,
}: {
  person: AlumniRow;
  existingTags?: Record<string, Set<string>>;
  onTagAdded?: (category: string, value: string) => void;
  higherStudies?: HigherStudyRow[];
  workExperience?: WorkExperienceRow[];
}) {


  const showTagButtons = !!(existingTags && onTagAdded);
  return (
    <div className="a-card__rows" style={{ marginTop: 14 }}>
      <p className="a-row" style={{ margin: '4px 0' }}>
        <strong>College:</strong>&nbsp;{person.college_name_raw || '—'}
        {person.college_name_raw && (
          <AddCollegeButton alumniId={person.id} collegeName={person.college_name_raw} hasMatch={!!person.college_id} />
        )}
        &nbsp;&nbsp;
        <strong>Degree:</strong>&nbsp;{person.degree || '—'}
        {showTagButtons && person.degree && (
          <AddTagButton category="degree" value={person.degree} existingTags={existingTags!} onAdded={onTagAdded!} />
        )}
        &nbsp;&nbsp;
        <strong>Branch:</strong>&nbsp;{person.branch || '—'}&nbsp;&nbsp;
        <strong>Field:</strong>&nbsp;{person.field || '—'}
      </p>
      <p className="a-row" style={{ margin: '4px 0' }}>
        <strong>Admission:</strong>&nbsp;{person.admission_route}
        {showTagButtons && person.admission_route && (
          <AddTagButton category="admission_route" value={person.admission_route} existingTags={existingTags!} onAdded={onTagAdded!} />
        )}
        {person.admission_rank ? ` (Rank: ${person.admission_rank})` : ''}
        {person.board_marks ? ` (${person.board_marks}%)` : ''}
      </p>
      <p className="a-row" style={{ margin: '4px 0' }}>
        <strong>Status:</strong>&nbsp;{person.current_status}
        {showTagButtons && person.current_status && (
          <AddTagButton category="current_status" value={person.current_status} existingTags={existingTags!} onAdded={onTagAdded!} />
        )}
        {person.currently_at ? ` — ${person.designation || ''} at ${person.currently_at}` : ''}
      </p>
      {!!higherStudies?.length && (
        <div className="a-row" style={{ margin: '8px 0' }}>
          <strong>Higher studies:</strong>
          {higherStudies.map((s) => (
            <div key={s.id} style={{ marginLeft: 14, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              🎓 {s.degree_name}
              {s.institution ? ` — ${s.institution}` : ''}
              {(s.start_year || s.finish_year) ? ` (${s.start_year || '?'}–${s.finish_year || '?'})` : ''}
            </div>
          ))}
        </div>
      )}
      {!!workExperience?.length && (
        <div className="a-row" style={{ margin: '8px 0' }}>
          <strong>Work experience:</strong>
          {workExperience.map((w) => (
            <div key={w.id} style={{ marginLeft: 14, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              💼 {w.role ? `${w.role} at ` : ''}{w.company}
              {w.start_year ? ` (${w.start_year}–${w.is_current ? 'Present' : (w.end_year || '?')})` : ''}
            </div>
          ))}
        </div>
      )}
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
function UnmatchedCollegeRow({
  groupKey, display, alumniIds, onResolved,
}: {
  groupKey: string;
  display: string;
  alumniIds: string[];
  onResolved: (key: string) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'editing' | 'saving' | 'error'>('idle');
  const [draft, setDraft] = useState(display);

  async function handleSave() {
    const finalName = draft.trim();
    if (!finalName) return;
    setMode('saving');
    const { data, error } = await supabase.from('colleges').insert({ name: finalName, added_by_admin: true }).select().single();
    if (error || !data) { setMode('error'); return; }
    const { error: updateError } = await supabase.from('alumni').update({ college_id: data.id }).in('id', alumniIds);
    if (updateError) { setMode('error'); return; }
    onResolved(groupKey);
  }

  return (
    <div className="card" style={{ marginBottom: 14, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700 }}>{display}</p>
          <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--text-faint)' }}>
            Typed by {alumniIds.length} student{alumniIds.length === 1 ? '' : 's'}
          </p>
        </div>

        {mode === 'idle' && (
          <button type="button" onClick={() => setMode('editing')} className="btn btn--ghost">
            <span className="btn__inner">✎ Correct &amp; add for all</span>
          </button>
        )}

        {(mode === 'editing' || mode === 'saving' || mode === 'error') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CollegeAutocompleteInput value={draft} onChange={setDraft} disabled={mode === 'saving'} />
            <button type="button" onClick={handleSave} disabled={mode === 'saving'} className="btn btn--primary">
              <span className="btn__inner">{mode === 'saving' ? 'Saving…' : mode === 'error' ? 'Try again' : '✓ Save for all'}</span>
            </button>
            <button type="button" onClick={() => { setMode('idle'); setDraft(display); }} className="btn btn--neutral">
              <span className="btn__inner">Cancel</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
// A small text input with a live dropdown of matching colleges as you type,
// used inside both the per-person and bulk college correctors so staff can
// link to an existing college instead of accidentally creating a near-
// duplicate row.
function CollegeAutocompleteInput({
  value, onChange, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [results, setResults] = useState<{ id: string; name: string; state: string | null }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 3) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('colleges')
        .select('id, name, state')
        .or(`name.ilike.%${query}%,short_names.ilike.%${query}%`)
        .order('name')
        .limit(8);
      setResults(data ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
        style={{
          fontSize: '0.88rem', padding: '7px 12px', borderRadius: 'var(--r-sm)',
          border: '1px solid var(--border-strong)', background: 'var(--surface-2)', color: 'var(--text)',
          width: 260,
        }}
      />
      {open && value.trim().length >= 3 && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--surface-2)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-sm)', maxHeight: 200, overflowY: 'auto', zIndex: 30,
          boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
        }}>
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(r.name); setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)',
                color: 'var(--text)', cursor: 'pointer', fontSize: '0.85rem',
              }}
            >
              {r.name}{r.state && <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}> — {r.state}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function AddCollegeButton({ alumniId, collegeName, hasMatch }: { alumniId: string; collegeName: string; hasMatch: boolean }) {
  const [mode, setMode] = useState<'idle' | 'editing' | 'saving' | 'done' | 'error'>('idle');
  const [draft, setDraft] = useState(collegeName);

  if (hasMatch || !collegeName) return null;

  async function handleSave() {
    const finalName = draft.trim();
    if (!finalName) return;
    setMode('saving');
    const { data, error } = await supabase.from('colleges').insert({ name: finalName, added_by_admin: true }).select().single();
    if (error || !data) { setMode('error'); return; }
    await supabase.from('alumni').update({ college_id: data.id }).eq('id', alumniId);
    setMode('done');
  }

  if (mode === 'done') {
    return <span className="tag-add-btn tag-add-btn--done">✓ Added as "{draft}"</span>;
  }

  if (mode === 'editing' || mode === 'saving' || mode === 'error') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
        <CollegeAutocompleteInput value={draft} onChange={setDraft} disabled={mode === 'saving'} />
        <button type="button" onClick={handleSave} disabled={mode === 'saving'} className="tag-add-btn">
          {mode === 'saving' ? 'Saving…' : mode === 'error' ? 'Try again' : '✓ Save'}
        </button>
        <button type="button" onClick={() => { setMode('idle'); setDraft(collegeName); }} className="tag-add-btn">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button type="button" onClick={() => setMode('editing')} className="tag-add-btn" title={`Correct and add "${collegeName}" to the colleges list`}>
      ✎ Correct &amp; add
    </button>
  );
}
function CollegeDeleteRow({
  id, name, onDeleted,
}: {
  id: string;
  name: string;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<'idle' | 'deleting' | 'error'>('idle');

  async function handleConfirmDelete() {
    setState('deleting');
    const { error: unlinkError } = await supabase.from('alumni').update({ college_id: null }).eq('college_id', id);
    if (unlinkError) { setState('error'); return; }
    const { error: deleteError } = await supabase.from('colleges').delete().eq('id', id);
    if (deleteError) { setState('error'); return; }
    onDeleted();
  }

  return (
    <div style={{
      border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)',
      padding: '10px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.92rem' }}>{name}</span>
        {!confirming && (
          <button type="button" onClick={() => setConfirming(true)} className="tag-add-btn" title="Delete this college">
            🗑 Delete
          </button>
        )}
      </div>

      {confirming && (
        <div style={{
          marginTop: 10, background: 'var(--danger-bg)', border: '1px solid var(--danger-border)',
          color: 'var(--danger-ink)', padding: '12px 14px', borderRadius: 'var(--r-sm)', fontSize: '0.85rem',
        }}>
          <p style={{ margin: '0 0 10px 0' }}>
            This will permanently delete <strong>"{name}"</strong> and remove it from any student profiles currently
            linked to it (they'll go back to showing no college until re-corrected). This can't be undone.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleConfirmDelete} disabled={state === 'deleting'} className="btn btn--neutral">
              <span className="btn__inner">
                {state === 'deleting' ? 'Deleting…' : state === 'error' ? 'Try again' : `Yes, delete "${name}"`}
              </span>
            </button>
            <button type="button" onClick={() => { setConfirming(false); setState('idle'); }} disabled={state === 'deleting'} className="btn btn--ghost">
              <span className="btn__inner">Cancel</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function TagDeleteChip({
  category, value, onDeleted,
}: {
  category: string;
  value: string;
  onDeleted: () => void;
}) {
  const [state, setState] = useState<'idle' | 'deleting' | 'error'>('idle');

  async function handleDelete() {
    setState('deleting');
    const { error } = await supabase.from('field_options').delete().eq('category', category).eq('value', value);
    if (error) { setState('error'); return; }
    onDeleted();
  }

  return (
    <span className="tag-add-btn" style={{ borderStyle: 'solid' }}>
      {value}
      <button
        type="button"
        onClick={handleDelete}
        disabled={state === 'deleting'}
        title={`Remove "${value}" from the options list`}
        style={{
          background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer',
          padding: 0, marginLeft: 4, fontSize: '0.9em', lineHeight: 1,
        }}
      >
        {state === 'deleting' ? '…' : state === 'error' ? '⚠' : '✕'}
      </button>
    </span>
  );
}




// A small pill button shown next to a field's value when that value is a
// free-typed "Other" answer (not in KNOWN_VALUES and not already promoted).
// One click inserts it into field_options so it becomes a real, selectable
// option on the registration/profile forms from then on.
function AddTagButton({
  category, value, existingTags, onAdded,
}: {
  category: string;
  value: string;
  existingTags: Record<string, Set<string>>;
  onAdded: (category: string, value: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  const isKnown =
    !value ||
    (KNOWN_VALUES[category] ?? []).includes(value) ||
    existingTags[category]?.has(value);

  if (isKnown) return null;

  async function handleAdd() {
    setState('saving');
    const { error } = await supabase
      .from('field_options')
      .upsert({ category, value }, { onConflict: 'category,value', ignoreDuplicates: true });
    if (error) { setState('error'); return; }
    setState('done');
    onAdded(category, value);
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={state === 'saving' || state === 'done'}
      className={`tag-add-btn${state === 'done' ? ' tag-add-btn--done' : ''}`}
      title={`Make "${value}" a selectable option on the registration form`}
    >
      {state === 'done' ? '✓ Added' : state === 'saving' ? 'Adding…' : state === 'error' ? 'Try again' : `+ Add as option`}
    </button>
  );
}