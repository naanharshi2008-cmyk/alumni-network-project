'use client';

/**
 * The pieces every part of the dashboard uses.
 *
 * Gathered here when the admin page was split into Review / People / Data, so
 * a person looks the same wherever they appear and a confirmation behaves the
 * same whatever it is confirming. Three separate inline-confirm components had
 * drifted apart before this; they are now one.
 */

import React, { useState } from 'react';
import { formatMonthYear } from '../../lib/text';
import { officialSchoolName } from '../../lib/options';
import { categoryForDegree } from '../../lib/types';
import { supabase } from '../../lib/supabaseClient';
import type { AlumniRow, HigherStudyRow, WorkExperienceRow } from './adminData';
import { FIELD_LABELS } from './adminData';
import { splitStaged } from './editFields';

/**
 * Ask before doing something that cannot be taken back.
 *
 * One component for every such control in the dashboard. Pass `reason` when
 * the school should be able to say why - rejecting a registration, discarding
 * someone's edits - and the answer arrives as the argument to `onConfirm`.
 *
 * The reason box replaced window.prompt: after a few dialogs browsers offer
 * "prevent this page from creating additional dialogs", and if staff tick that
 * mid-batch prompt() returns null for ever, so every later Reject silently did
 * nothing - during exactly the batch that provoked it.
 */
export function ConfirmAction({
  label, question, confirmLabel, busyLabel, onConfirm,
  reason, className = 'btn btn--neutral', wide = false,
}: {
  label: React.ReactNode;
  question: React.ReactNode;
  confirmLabel: string;
  busyLabel: string;
  onConfirm: (reason: string) => Promise<void> | void;
  reason?: { placeholder: string };
  className?: string;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState('');

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <span className="btn__inner">{label}</span>
      </button>
    );
  }

  return (
    <div className="delete-confirm" style={wide ? { width: '100%' } : undefined}>
      <p style={{ margin: '0 0 10px 0' }}>{question}</p>
      {reason && (
        <input
          type="text" value={why} autoFocus
          onChange={(e) => setWhy(e.target.value)}
          placeholder={reason.placeholder}
          style={{ marginBottom: 10 }}
        />
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button" disabled={busy} className="btn btn--neutral"
          onClick={async () => { setBusy(true); await onConfirm(why); setBusy(false); }}
        >
          <span className="btn__inner">{busy ? busyLabel : confirmLabel}</span>
        </button>
        <button
          type="button" disabled={busy} className="btn btn--ghost"
          onClick={() => { setOpen(false); setWhy(''); }}
        >
          <span className="btn__inner">Cancel</span>
        </button>
      </div>
    </div>
  );
}

/**
 * A temporary password, shown once.
 *
 * Used both when the school issues a login for an existing profile and when it
 * adds someone itself, so the copy and the warning cannot drift apart.
 */
export function TempPassword({ password, children }: { password: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div className="account-help__temp">
        <code>{password}</code>
        <button
          type="button" className="btn btn--ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch { /* select it by hand */ }
          }}
        >
          <span className="btn__inner">{copied ? '✓ Copied' : 'Copy'}</span>
        </button>
      </div>
      <p className="hint" style={{ display: 'block', margin: '8px 0 0' }}>
        {children ?? 'Send it to them privately. They sign in with their email or phone and this password, then choose their own. It will not be shown again.'}
      </p>
    </>
  );
}

export function TabButton({ active, onClick, label, count }: {
  active: boolean; onClick: () => void; label: string; count: number;
}) {
  return (
    <button type="button" className={`chip${active ? ' chip--active' : ''}`} onClick={onClick}>
      {label}
      <span style={{ opacity: 0.7, marginLeft: 6 }}>{count}</span>
    </button>
  );
}

export function EmptyCard({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="card empty">
      <span className="empty__emoji">{emoji}</span>
      <p style={{ margin: 0 }}>{text}</p>
    </div>
  );
}

export function TabIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tab-intro">
      <h3>{title}</h3>
      <p style={{ margin: 0 }}>{children}</p>
    </div>
  );
}

export function PersonHeader({ person, isNew }: { person: AlumniRow; isNew?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
      <div>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem' }}>
          {person.full_name}
          {isNew && <span className="badge badge--xs badge--ok" style={{ marginLeft: 8 }}>NEW</span>}
          {person.consent_given === false && (
            <span className="badge badge--xs" style={{ marginLeft: 8 }}>added by the school</span>
          )}
        </h3>
        <p className="subtitle" style={{ margin: 0, fontSize: '0.86rem' }}>
          Class of {person.class_of}{person.stream ? ` · ${person.stream}` : ''}
          {/* The one field the office can actually verify someone against. */}
          {person.admission_number && <> · Adm. no. <strong>{person.admission_number}</strong></>}
          {person.last_updated && <> · Updated {formatMonthYear(person.last_updated)}</>}
          {person.last_confirmed_at && <> · Confirmed {formatMonthYear(person.last_confirmed_at)}</>}
          {person.school_name && <> · {officialSchoolName(person.school_name)}</>}
        </p>
      </div>
      <div className="avatar">
        {person.photo_url ? <img src={person.photo_url} alt="" /> : person.full_name?.charAt(0)}
      </div>
    </div>
  );
}

/** "corrected from Engineering", when the stored area is not the one the degree implies. */
function fieldCorrection(person: AlumniRow): string | null {
  const guess = categoryForDegree(person.degree, person.branch, person.professional_course);
  const stored = (person.field ?? '').trim();
  if (!guess || !stored || guess.label === stored) return null;
  return `corrected from ${guess.label}`;
}

export function PersonDetails({ person, higherStudies, workExperience }: {
  person: AlumniRow;
  higherStudies?: HigherStudyRow[];
  workExperience?: WorkExperienceRow[];
}) {
  return (
    <div className="a-card__rows" style={{ marginTop: 14 }}>
      <div className="a-row" style={{ margin: '4px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 22px' }}>
        <span><strong>College:</strong>&nbsp;{person.college_name_raw || '—'}{!person.college_id && person.college_name_raw && <span className="badge badge--xs" style={{ marginLeft: 6 }}>unmatched</span>}</span>
        <span><strong>Degree:</strong>&nbsp;{person.degree || '—'}</span>
        <span><strong>Branch:</strong>&nbsp;{person.branch || '—'}</span>
        <span>
          <strong>Field:</strong>&nbsp;{person.field || '—'}
          {/* Worked out from the degree at registration, so saying when it
              was overruled is the only way to tell a considered answer from
              the default. */}
          {fieldCorrection(person) && <span className="hint">{fieldCorrection(person)}</span>}
        </span>
      </div>
      {person.professional_course && (
        <p className="a-row" style={{ margin: '4px 0' }}>
          {/* A CA or CS student may have no degree at all, so without this the
              review card showed them as an empty row. */}
          <strong>Professional course:</strong>&nbsp;{person.professional_course}
          {person.professional_stage ? ` (${person.professional_stage})` : ''}
          {person.professional_org ? ` — ${person.professional_org}` : ''}
        </p>
      )}
      <p className="a-row" style={{ margin: '4px 0' }}>
        <strong>Admission through:</strong>&nbsp;{person.admission_route || '—'}
        {person.admission_rank ? ` (Rank: ${person.admission_rank})` : ''}
        {person.board_marks ? ` (${person.board_marks}%)` : ''}
      </p>
      <p className="a-row" style={{ margin: '4px 0' }}>
        <strong>Status:</strong>&nbsp;{person.current_status || '—'}
        {person.currently_at ? ` — ${person.designation || ''} at ${person.currently_at}` : ''}
      </p>

      {!!higherStudies?.length && (
        <div className="a-row" style={{ margin: '8px 0' }}>
          <strong>Higher studies:</strong>
          {higherStudies.map((s) => (
            <div key={s.id} style={{ marginLeft: 14, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              🎓 {s.degree_name}{s.institution ? ` — ${s.institution}` : ''}
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
      {person.message_1 && (
        <p className="a-row" style={{ margin: '4px 0', fontStyle: 'italic', color: 'var(--text-muted)' }}>
          &ldquo;{person.message_1}&rdquo;
        </p>
      )}
      <p style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginTop: 8 }}>
        Private — Email: {person.personal_email || '—'} | Phone: {person.phone_country_code ?? ''}{person.phone_number || '—'}
      </p>
    </div>
  );
}

/** Side-by-side "what's published" vs "what they want to change it to". */
export function EditDiff({ person }: { person: AlumniRow }) {
  const staged = person.pending_changes ?? {};
  // Anything the profile editor never sets. It is dropped at publish time, but
  // silence would be worse than the old bug: the school should see that
  // something tried to reach a column nobody asked about.
  const { unknown } = splitStaged(staged);
  const changed = Object.keys(FIELD_LABELS).filter((key) => {
    if (!(key in staged)) return false;
    const oldVal = (person as any)[key];
    const newVal = staged[key];
    if (oldVal === newVal) return false;
    return !(!oldVal && !newVal);
  });

  if (changed.length === 0 && unknown.length === 0) {
    return <p className="subtitle" style={{ fontSize: '0.86rem' }}>No field changes — only timeline entries were edited.</p>;
  }

  return (
    <>
    {unknown.length > 0 && (
      <div className="diff-unknown">
        <p className="diff-unknown__head">Not recognised — these will not be published</p>
        <ul>
          {unknown.map(([key, value]) => (
            <li key={key}><code>{key}</code> <span>{JSON.stringify(value)}</span></li>
          ))}
        </ul>
        <p className="diff-unknown__note">
          The profile editor never sets these, so nothing here reaches the directory.
          If it keeps happening, tell whoever maintains the site.
        </p>
      </div>
    )}
    {changed.length === 0 ? (
      <p className="subtitle" style={{ fontSize: '0.86rem' }}>No other field changes.</p>
    ) : (
    <div className="diff-grid">
      <div className="diff-col diff-col--old">
        <p className="diff-col__title">Live on the directory now</p>
        {changed.map((key) => (
          <div key={key} style={{ marginBottom: 6 }}>
            <span className="diff-label">{FIELD_LABELS[key]}</span>
            <span className="diff-old">{String((person as any)[key] ?? '—')}</span>
          </div>
        ))}
      </div>
      <div className="diff-col diff-col--new">
        <p className="diff-col__title">Proposed — not public yet</p>
        {changed.map((key) => (
          <div key={key} style={{ marginBottom: 6 }}>
            <span className="diff-label">{FIELD_LABELS[key]}</span>
            <span className="diff-new">{String(staged[key] ?? '—')}</span>
          </div>
        ))}
      </div>
    </div>
    )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Account help: reset a password, or give an account-less profile a login.
   Works before school email is set up - the admin passes the temporary
   password on privately, and it must be replaced at next sign-in.
───────────────────────────────────────────────────────────────────────── */
export function AccountButton({ person }: { person: AlumniRow }) {
  const hasLogin = !!person.user_id;
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'done'>('idle');
  const [temp, setTemp] = useState('');
  const [err, setErr] = useState('');

  async function run() {
    setState('busy'); setErr('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setErr('Your session expired, please sign in again.'); setState('confirm'); return; }
    const res = await fetch(hasLogin ? '/api/admin/reset-password' : '/api/admin/create-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ alumniId: person.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(body.error ?? 'That did not work. Please try again.'); setState('confirm'); return; }
    setTemp(body.temporaryPassword);
    setState('done');
  }

  if (state === 'idle') {
    return (
      <button type="button" className="btn btn--ghost" onClick={() => setState('confirm')}>
        <span className="btn__inner">{hasLogin ? 'Reset password' : 'Create login'}</span>
      </button>
    );
  }

  return (
    <div className="account-help">
      {state === 'done' ? (
        <>
          <p style={{ margin: '0 0 8px' }}>
            Temporary password for <strong>{person.full_name}</strong>:
          </p>
          <TempPassword password={temp} />
          <button type="button" className="btn btn--ghost" style={{ marginTop: 10 }} onClick={() => { setTemp(''); setState('idle'); }}>
            <span className="btn__inner">Done</span>
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 10px' }}>
            {hasLogin
              ? <>Give <strong>{person.full_name}</strong> a temporary password? Their current password stops working.</>
              : <>Create a login for <strong>{person.full_name}</strong>? They will sign in with the email or phone on this profile.</>}
          </p>
          {err && <p className="field__error field__error--static">{err}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn--neutral" disabled={state === 'busy'} onClick={run}>
              <span className="btn__inner">{state === 'busy' ? 'Working…' : hasLogin ? 'Yes, reset it' : 'Yes, create it'}</span>
            </button>
            <button type="button" className="btn btn--ghost" disabled={state === 'busy'} onClick={() => { setErr(''); setState('idle'); }}>
              <span className="btn__inner">Cancel</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
