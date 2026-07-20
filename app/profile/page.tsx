'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import { commonOrganizations } from '../../lib/commonOrganizations';
import { CATEGORIES } from '../../lib/types';

interface AlumnusData {
  id: string;
  full_name: string;
  username: string;
  school_name: string;
  admission_number: string;
  class_of: string;
  stream: string;
  school_board: string;
  personal_email: string;
  phone_country_code: string;
  phone_number: string;
  linkedin_url: string;
  college_name: string;
  degree: string;
  branch: string;
  field: string;
  admission_route: string;
  admission_rank: string;
  board_marks: string;
  board_cutoff: string;
  current_status: string;
  expected_finish_year: string;
  currently_at: string;
  designation: string;
  message_1: string;
  message_2: string;
  photo_url: string | null;
  approval_status: string;
  modification_status: string;
  original_data: any;
}

// The database allows most of these fields to be null (many were made
// optional over time), but every .trim() call in this file assumes a real
// string. Loading a raw Supabase row straight into state let a null value
// slip through and crash on save with "Cannot read properties of null
// (reading 'trim')". This normalizer guarantees every string field really
// is a string (never null/undefined) the moment data comes in, so nothing
// downstream needs to guard against null itself.
function normalizeProfile(raw: any): AlumnusData {
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    ...raw,
    full_name: str(raw.full_name),
    username: str(raw.username),
    school_name: str(raw.school_name),
    admission_number: str(raw.admission_number),
    class_of: raw.class_of ? String(raw.class_of) : '',
    stream: str(raw.stream),
    school_board: str(raw.school_board),
    personal_email: str(raw.personal_email),
    phone_country_code: str(raw.phone_country_code),
    phone_number: str(raw.phone_number),
    linkedin_url: str(raw.linkedin_url),
    college_name: raw.colleges?.name || '',
    degree: str(raw.degree),
    branch: str(raw.branch),
    field: str(raw.field),
    admission_route: str(raw.admission_route),
    admission_rank: raw.admission_rank ? String(raw.admission_rank) : '',
    board_marks: raw.board_marks ? String(raw.board_marks) : '',
    board_cutoff: str(raw.board_cutoff),
    current_status: str(raw.current_status),
    expected_finish_year: raw.expected_finish_year ? String(raw.expected_finish_year) : '',
    currently_at: str(raw.currently_at),
    designation: str(raw.designation),
    message_1: str(raw.message_1),
    message_2: str(raw.message_2),
    photo_url: raw.photo_url ?? null,
    approval_status: str(raw.approval_status),
    modification_status: str(raw.modification_status),
  };
}

const CURRENT_YEAR = new Date().getFullYear();
const STREAMS = ['Bio-Maths', 'CS-Maths', 'Commerce (Business & Finance)', 'Other'];
const ROUTES = [
  'JEE Main', 'JEE Advanced', 'NEET', 'CUET', 'BITSAT', 'VITEEE', 'SRMJEEE',
  'COMEDK', 'KCET', 'MHT-CET', 'WBJEE', 'KEAM', 'CLAT', 'Board Marks', 'Other'
];
const SCHOOL_BOARDS = ['State Board', 'CBSE', 'ICSE', 'Other'];
const STATUSES = ['Studying UG', 'Studying PG', 'Working', 'Entrepreneur', 'Preparing', 'On Break', 'Other'];
const DEGREES = ['BTech', 'BE', 'BSc', 'MBBS', 'BCom', 'BA', 'BArch', 'LLB', 'BBA', 'BCA'];
const COUNTRY_CODES = ['+91', '+1', '+44', '+61', '+971', '+65', '+49', '+33', '+81', '+86'];
const SCHOOLS = ['Veveaham Hr. Sec. School', 'Veveaham Prime Academy'];

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [profile, setProfile] = useState<AlumnusData | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const [orgOptions, setOrgOptions] = useState<string[]>(commonOrganizations);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/login');
        return;
      }
      loadProfile(session.user.id);
    });
  }, []);

  async function loadProfile(userId: string) {
    setLoading(true);
    try {
      // Load alumni profile
      const { data, error: profileErr } = await supabase
        .from('alumni')
        .select('*, colleges(name)')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileErr) throw profileErr;

      if (!data) {
        // Fallback search by email
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: fallbackData } = await supabase
            .from('alumni')
            .select('*, colleges(name)')
            .eq('personal_email', user.email)
            .maybeSingle();
          if (fallbackData) {
            setProfile(normalizeProfile(fallbackData));
          }
        }
      } else {
        setProfile(normalizeProfile(data));
      }

      const { data: currentOrgs } = await supabase.from('alumni').select('currently_at').eq('approval_status', 'approved');
      if (currentOrgs) {
        const orgs = currentOrgs.map(a => a.currently_at as string).filter(Boolean);
        setOrgOptions(Array.from(new Set([...commonOrganizations, ...orgs])).sort());
      }
    } catch (e) {
      console.error(e);
      setError('Could not load profile details.');
    } finally {
      setLoading(false);
    }
  }

  function updateField<K extends keyof AlumnusData>(key: K, value: AlumnusData[K]) {
    if (profile) {
      setProfile({ ...profile, [key]: value });
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      let photoUrl = profile.photo_url;
      
      // Upload new photo if selected
      if (photoFile) {
        const MAX_BYTES = 5 * 1024 * 1024;
        if (!photoFile.type.startsWith('image/')) {
          throw new Error('Please upload an image file (JPG, PNG, WEBP...).');
        }
        if (photoFile.size > MAX_BYTES) {
          throw new Error('Photo is too large, please pick one under 5MB.');
        }
        const extMatch = photoFile.name.match(/\.([a-zA-Z0-9]{1,5})$/);
        const ext = (extMatch?.[1] ?? 'jpg').toLowerCase();
        const safeUsername = profile.username.replace(/[^a-zA-Z0-9-_]/g, '_');
        const fileName = `${safeUsername}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('photos').upload(fileName, photoFile, {
          contentType: photoFile.type,
        });
        if (upErr) throw upErr;
        photoUrl = supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;
      }

      // Look up the college - we no longer create new rows here, same as
      // registration. See the matching fix in app/register/page.tsx for
      // the full reasoning (RLS blocked this for regular users anyway).
      let collegeId: string | number | null = null;
      const typedCollege = profile.college_name.trim();
      if (typedCollege) {
        const { data: existing } = await supabase
          .from('colleges')
          .select('id')
          .ilike('name', typedCollege)
          .maybeSingle();
        if (existing) {
          collegeId = existing.id;
        }
      }

      // Update in alumni database
      const updateData: any = {
        full_name: profile.full_name.trim(),
        school_name: profile.school_name,
        admission_number: profile.admission_number || null,
        class_of: profile.class_of ? parseInt(profile.class_of, 10) : null,
        stream: profile.stream,
        school_board: profile.school_board,
        personal_email: profile.personal_email.trim(),
        phone_country_code: profile.phone_country_code,
        phone_number: profile.phone_number || null,
        linkedin_url: profile.linkedin_url.trim() || null,
        college_id: collegeId,
        degree: profile.degree.trim() || null,
        branch: profile.branch.trim() || null,
        field: profile.field.trim() || null,
        admission_route: profile.admission_route,
        admission_rank: profile.admission_rank.trim() || null,
        board_marks: profile.board_marks.trim() || null,
        board_cutoff: profile.board_cutoff.trim() || null,
        current_status: profile.current_status,
        expected_finish_year: profile.expected_finish_year ? parseInt(profile.expected_finish_year, 10) : null,
        currently_at: profile.currently_at.trim() || null,
        designation: profile.designation.trim() || null,
        message_1: profile.message_1.trim() || null,
        photo_url: photoUrl,
        show_photo: !!photoUrl,
      };

      // Set modification status to pending if they are already approved
      if (profile.approval_status === 'approved') {
        updateData.modification_status = 'pending';
      }

      const { error: saveErr } = await supabase
        .from('alumni')
        .update(updateData)
        .eq('id', profile.id);

      if (saveErr) throw saveErr;

      setSuccess('Your profile modifications have been submitted for review.');
      setProfile(prev => prev ? { ...prev, ...updateData, photo_url: photoUrl } : null);
      setPhotoFile(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (loading) {
    return (
      <div className="container container--narrow">
        <p className="subtitle">Loading your profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container container--narrow">
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <h2>Profile Not Found</h2>
          <p className="subtitle">We couldn't locate an alumnus record associated with this account.</p>
          <button type="button" onClick={handleLogout} className="btn btn--neutral" style={{ marginTop: 12 }}>
            <span className="btn__inner">Log Out</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="container container--narrow">
      <div className="card fade-up">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', margin: 0 }}>My Profile Dashboard</h1>
            <p className="subtitle" style={{ margin: 0 }}>Manage your alumni network details.</p>
          </div>
          <button type="button" onClick={handleLogout} className="btn btn--ghost">
            <span className="btn__inner">Log Out</span>
          </button>
        </div>

        {/* Status indicator */}
        <div style={{
          background: profile.approval_status === 'pending' ? 'rgba(242, 195, 78, 0.08)' : 'var(--grad-soft)',
          border: '1px solid ' + (profile.approval_status === 'pending' ? 'var(--gold)' : 'var(--emerald)'),
          padding: '14px 16px',
          borderRadius: 'var(--r-sm)',
          marginBottom: 20,
          color: 'var(--text)'
        }}>
          <strong>Profile Status: </strong>
          {profile.approval_status === 'pending' ? (
            <span style={{ color: 'var(--gold)' }}>Pending Verification Review</span>
          ) : profile.modification_status === 'pending' ? (
            <span style={{ color: 'var(--gold)' }}>Edits Under Review (Directory shows last approved version)</span>
          ) : (
            <span style={{ color: 'var(--emerald)' }}>Verified & Live on Directory ✨</span>
          )}
        </div>

        {error && <div className="alert alert--error" style={{ marginBottom: 18 }}>{error}</div>}
        {success && <div className="alert alert--success" style={{ marginBottom: 18 }}>{success}</div>}

        <form onSubmit={handleSave}>
          <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20 }}>
            <div className="avatar" style={{ width: 80, height: 80, fontSize: '2rem' }}>
              {profile.photo_url ? (
                <img src={profile.photo_url} alt={profile.full_name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                profile.full_name.charAt(0)
              )}
            </div>
            <div>
              <label>Update profile photo</label>
              <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} style={{ marginTop: 6 }} />
              {photoFile && <div className="hint" style={{ marginTop: 4 }}>✓ Selected: {photoFile.name}</div>}
            </div>
          </div>

          <hr style={{ border: 'none', borderBottom: '1px solid var(--border)', margin: '24px 0' }} />

          <h3>Basics</h3>
          <div className="field">
            <label>School Name</label>
            <Chips options={SCHOOLS} value={profile.school_name} onChange={(v) => updateField('school_name', v)} />
          </div>

          <FloatingField label="Full name" value={profile.full_name} onChange={(v) => updateField('full_name', v)} />

          <div className="two-col">
            <FloatingField label="Admission number" hint="optional" value={profile.admission_number || ''} onChange={(v) => updateField('admission_number', v)} />
            <FloatingField label="Graduating year (Class of)" type="number" max={CURRENT_YEAR} value={profile.class_of} onChange={(v) => updateField('class_of', v)} />
          </div>

          <div className="field">
            <label>Stream at school</label>
            <Chips options={STREAMS} value={STREAMS.includes(profile.stream) ? profile.stream : 'Other'} onChange={(v) => updateField('stream', v)} />
          </div>

          <div className="field">
            <label>School board</label>
            <Chips options={SCHOOL_BOARDS} value={SCHOOL_BOARDS.includes(profile.school_board) ? profile.school_board : 'Other'} onChange={(v) => updateField('school_board', v)} />
          </div>

          <hr style={{ border: 'none', borderBottom: '1px solid var(--border)', margin: '24px 0' }} />

          <h3>Higher Education</h3>
          <div className="field">
            <label>Broad Area of Study</label>
            <select value={profile.field} onChange={(e) => updateField('field', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.key} value={c.label}>{c.emoji} {c.label}</option>)}
            </select>
          </div>

          <CollegeSearchField
            value={profile.college_name}
            onChange={(v) => updateField('college_name', v)}
          />

          <FloatingField label="Degree" value={profile.degree} onChange={(v) => updateField('degree', v)} />
          <FloatingField label="Branch / Department" value={profile.branch} onChange={(v) => updateField('branch', v)} />

          <div className="field">
            <label>Admission Route</label>
            <select value={ROUTES.includes(profile.admission_route) ? profile.admission_route : 'Other'} onChange={(e) => updateField('admission_route', e.target.value)}>
              {ROUTES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {profile.admission_route === 'Board Marks' ? (
            <div className="two-col">
              <FloatingField label="Board Marks (%)" type="number" min={0} max={100} step={0.01} value={profile.board_marks} onChange={(v) => updateField('board_marks', v)} />
              <FloatingField label="Cutoff" value={profile.board_cutoff} onChange={(v) => updateField('board_cutoff', v)} />
            </div>
          ) : (
            !['Direct', 'Other'].includes(profile.admission_route) && (
              <FloatingField label="Admission Rank" type="number" min={1} value={profile.admission_rank} onChange={(v) => updateField('admission_rank', v)} />
            )
          )}

          <hr style={{ border: 'none', borderBottom: '1px solid var(--border)', margin: '24px 0' }} />

          <h3>Current Status</h3>
          <div className="field">
            <label>What are you up to now?</label>
            <select value={STATUSES.includes(profile.current_status) ? profile.current_status : 'Other'} onChange={(e) => updateField('current_status', e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {(profile.current_status.toLowerCase().includes('studying') || profile.current_status.toLowerCase().includes('preparing')) && (
            <FloatingField label="Expected to finish in (Year)" type="number" min={CURRENT_YEAR} max={CURRENT_YEAR + 6} value={profile.expected_finish_year} onChange={(v) => updateField('expected_finish_year', v)} />
          )}

          <div className="two-col">
            <FloatingField label="Currently at (Company/Institute)" value={profile.currently_at || ''} onChange={(v) => updateField('currently_at', v)} list="profile-org-list" />
            <datalist id="profile-org-list">
              {orgOptions.map(o => <option key={o} value={o} />)}
            </datalist>
            <FloatingField label="Role / Designation" value={profile.designation || ''} onChange={(v) => updateField('designation', v)} />
          </div>

          <FloatingField label="LinkedIn Profile URL" type="url" value={profile.linkedin_url || ''} onChange={(v) => updateField('linkedin_url', v)} />
          <FloatingField label="Personal Email" type="email" value={profile.personal_email} onChange={(v) => updateField('personal_email', v)} />

          <div className="two-col">
            <FloatingSelect label="Country Code" value={profile.phone_country_code} onChange={(v) => updateField('phone_country_code', v)} options={COUNTRY_CODES} />
            <FloatingField label="Phone number" type="tel" value={profile.phone_number || ''} onChange={(v) => updateField('phone_number', v.replace(/\D/g, ''))} />
          </div>

          <div className="field" style={{ marginTop: 20 }}>
            <label>Suggestions / Advice for juniors</label>
            <textarea value={profile.message_1 || ''} onChange={(e) => updateField('message_1', e.target.value)} placeholder="Share advice, tips, or preparation routes..." />
          </div>

          <button type="submit" disabled={saving} className="btn btn--neutral btn--lg btn--block" style={{ marginTop: 24 }}>
            <span className="btn__inner">{saving ? <span className="spinner" /> : 'Save Modifications 💾'}</span>
          </button>
        </form>
      </div>
    </main>
  );
}

/* ----- Helpers ----------------------------------------------------------- */

function FloatingField({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  list,
  autoFocus,
  style,
  min,
  max,
  step,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  list?: string;
  autoFocus?: boolean;
  style?: React.CSSProperties;
  min?: number;
  max?: number;
  step?: number;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const [focused, setFocused] = useState(false);
  const active = focused || (value && value.trim().length > 0);
  return (
    <div className={`f-field${active ? ' f-field--active' : ''}`} style={style}>
      <input
        id={id}
        type={type}
        list={list}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder=""
        autoFocus={autoFocus}
        min={min}
        max={max}
        step={step}
      />
      <label htmlFor={id}>{label}</label>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

// Live search-as-you-type against the full colleges table (47k+ rows) -
// same component as app/register/page.tsx. Kept as a separate copy here
// rather than a shared import to avoid restructuring this project's file
// layout; keep both in sync if this ever needs changing.
function CollegeSearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [results, setResults] = useState<{ id: string; name: string; state: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const id = 'f-college-university';

  useEffect(() => {
    const query = value.trim();
    if (query.length < 3) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('colleges')
        .select('id, name, state')
        .ilike('name', `%${query}%`)
        .order('name')
        .limit(12);
      setResults(data ?? []);
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [value]);

  const active = focused || value.trim().length > 0;

  return (
    <div className={`f-field${active ? ' f-field--active' : ''}`} style={{ position: 'relative' }}>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { setFocused(true); setOpen(true); }}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder=""
        autoComplete="off"
      />
      <label htmlFor={id}>College / University</label>
      <span className="hint">start typing to search all 47,000+ colleges</span>

      {open && value.trim().length >= 3 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 6,
            background: 'var(--surface-2, #191621)',
            border: '1px solid var(--border-strong, #333)',
            borderRadius: 'var(--r-sm, 10px)',
            maxHeight: 260,
            overflowY: 'auto',
            zIndex: 20,
            boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
          }}
        >
          {loading && (
            <div style={{ padding: '10px 14px', color: 'var(--text-faint)', fontSize: '0.85rem' }}>Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div style={{ padding: '10px 14px', color: 'var(--text-faint)', fontSize: '0.85rem' }}>
              No match - not a problem, just keep your typed name and continue.
            </div>
          )}
          {!loading && results.map((r) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(r.name); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 14px',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              {r.name}
              {r.state && <span style={{ color: 'var(--text-faint)', fontSize: '0.78rem' }}> — {r.state}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FloatingSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="f-field f-field--active">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

function Chips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          type="button"
          key={o}
          className={`chip${value === o ? ' chip--active' : ''}`}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}