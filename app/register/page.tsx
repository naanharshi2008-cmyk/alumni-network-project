'use client';

import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import { commonColleges } from '../../lib/commonColleges';
import { commonOrganizations } from '../../lib/commonOrganizations';
import { CATEGORIES } from '../../lib/types';

interface FormState {
  full_name: string;
  admission_number: string;
  show_photo: 'yes' | 'no';
  photo_file: File | null;
  class_of: string;
  stream: string;
  personal_email: string;
  phone_number: string;
  linkedin_url: string;
  college_name: string;
  degree: string;
  branch: string;
  field: string;
  admission_route: string;
  admission_rank: string;
  current_status: string;
  currently_at: string;
  designation: string;
  message_1: string;
  message_2: string;
  consent_given: boolean;
}

const initialForm: FormState = {
  full_name: '',
  admission_number: '',
  show_photo: 'no',
  photo_file: null,
  class_of: '',
  stream: 'Bio-Maths',
  personal_email: '',
  phone_number: '',
  linkedin_url: '',
  college_name: '',
  degree: '',
  branch: '',
  field: 'Engineering',
  admission_route: 'JEE Main',
  admission_rank: '',
  current_status: 'Studying UG',
  currently_at: '',
  designation: '',
  message_1: '',
  message_2: '',
  consent_given: false,
};

const CURRENT_YEAR = new Date().getFullYear();
const STEPS = ['You', 'Studies', 'Now', 'Advice'];
const STREAMS = ['Bio-Maths', 'CS-Maths', 'Commerce', 'Other'];
const ROUTES = ['JEE Main', 'JEE Advanced', 'NEET', 'CUET', 'Board Marks', 'Sports Quota', 'Other'];
const STATUSES = ['Studying UG', 'Studying PG', 'Working', 'Entrepreneur', 'Preparing', 'Other'];
const DEGREES = ['BTech', 'BE', 'BSc', 'MBBS', 'BCom', 'BA', 'BArch', 'LLB', 'BBA', 'BCA'];

export default function RegisterPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const [collegeOptions, setCollegeOptions] = useState<string[]>(commonColleges);
  const [orgOptions, setOrgOptions] = useState<string[]>(commonOrganizations);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    (async () => {
      const { data } = await supabase.from('colleges').select('name').order('name');
      if (data) {
        const merged = Array.from(new Set([...commonColleges, ...data.map((c) => c.name as string)])).sort();
        setCollegeOptions(merged);
      }
    })();
    (async () => {
      // Only pull organisation names from already-approved profiles - pending/
      // unreviewed submissions shouldn't leak into another applicant's
      // autocomplete suggestions.
      const { data } = await supabase
        .from('alumni')
        .select('currently_at')
        .eq('approval_status', 'approved');
      if (data) {
        const orgs = data.map((a) => a.currently_at as string).filter(Boolean);
        setOrgOptions(Array.from(new Set([...commonOrganizations, ...orgs])).sort());
      }
    })();
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE = /^[6-9]\d{9}$/;
  const URL_RE = /^https?:\/\/.+/i;

  function validateStep(s: number): string {
    if (s === 0) {
      if (!form.full_name.trim()) return 'Please tell us your full name.';
      if (form.full_name.trim().length < 2) return 'Full name looks too short.';
      if (!form.admission_number.trim()) return 'Admission number is required.';
      const yr = parseInt(form.class_of, 10);
if (!form.class_of || Number.isNaN(yr) || yr < 1960 || yr > CURRENT_YEAR)
  return `Enter a valid graduating year, ${CURRENT_YEAR} or earlier.`;
    }
    if (s === 1) {
      if (!form.college_name.trim()) return 'Tell us which college or university you attended.';
      if (!form.degree.trim()) return 'Pick or type your degree.';
    }
    if (s === 2) {
      if (!form.currently_at.trim()) return 'Tell us where you currently study or work.';
      if (!form.designation.trim()) return 'Tell us your current role or designation.';
      if (form.linkedin_url.trim() && !URL_RE.test(form.linkedin_url.trim()))
        return 'Enter a valid LinkedIn URL, starting with https://';
      if (!form.personal_email.trim() || !EMAIL_RE.test(form.personal_email.trim()))
        return 'Enter a valid email address.';
      if (!form.phone_number.trim() || !PHONE_RE.test(form.phone_number.trim()))
        return 'Enter a valid 10-digit phone number.';
    }
    if (s === 1 && form.admission_rank.trim()) {
      const rank = parseInt(form.admission_rank, 10);
      if (Number.isNaN(rank) || rank <= 0) return 'Admission rank must be a positive number.';
    }
    return '';
  }

  function goNext() {
    const msg = validateStep(step);
    if (msg) {
      setError(msg);
      return;
    }
    setError('');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setError('');
    setStep((s) => Math.max(s - 1, 0));
  }

  // Enter / primary button: advance while there are steps left, else submit.
  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step < STEPS.length - 1) {
      goNext();
    } else {
      void submit();
    }
  }

  async function submit() {
    setError('');
    if (!isSupabaseConfigured) {
      setError('Supabase isn’t connected yet, add your keys to .env.local to enable submissions.');
      return;
    }
    if (!form.consent_given) {
      setError('Please tick the consent box so we can show your profile.');
      return;
    }

    setSubmitting(true);
    try {
      let photoUrl: string | null = null;
      if (form.photo_file) {
        const file = form.photo_file;
        const MAX_BYTES = 5 * 1024 * 1024;
        if (!file.type.startsWith('image/')) {
          throw new Error('Please upload an image file (JPG, PNG, WEBP...).');
        }
        if (file.size > MAX_BYTES) {
          throw new Error('Photo is too large, please pick one under 5MB.');
        }
        // Sanitize the extension so the storage key can't be used to smuggle
        // path segments or an unexpected content type into the bucket.
        const extMatch = file.name.match(/\.([a-zA-Z0-9]{1,5})$/);
        const ext = (extMatch?.[1] ?? 'jpg').toLowerCase();
        const safeAdmissionNo = form.admission_number.trim().replace(/[^a-zA-Z0-9-_]/g, '_');
        const fileName = `${safeAdmissionNo}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('photos').upload(fileName, file, {
          contentType: file.type,
        });
        if (upErr) throw upErr;
        photoUrl = supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;
      }

      // Find-or-create the college.
      let collegeId: string | number | null = null;
      if (form.college_name.trim()) {
        const { data: existing } = await supabase
          .from('colleges')
          .select('id')
          .ilike('name', form.college_name.trim())
          .maybeSingle();
        if (existing) {
          collegeId = existing.id;
        } else {
          const { data: created, error: cErr } = await supabase
            .from('colleges')
            .insert({ name: form.college_name.trim(), status: 'pending' })
            .select('id')
            .single();
          if (cErr) throw cErr;
          collegeId = created.id;
        }
      }

      const { error: insErr } = await supabase.from('alumni').insert({
        full_name: form.full_name.trim(),
        admission_number: form.admission_number.trim(),
        show_photo: form.show_photo === 'yes',
        photo_url: photoUrl,
        class_of: parseInt(form.class_of, 10),
        stream: form.stream,
        personal_email: form.personal_email.trim() || null,
        phone_number: form.phone_number.trim() || null,
        linkedin_url: form.linkedin_url.trim() || null,
        college_id: collegeId,
        degree: form.degree.trim() || null,
        branch: form.branch.trim() || null,
        field: form.field.trim() || null,
        admission_route: form.admission_route,
        admission_rank: form.admission_rank.trim() || null,
        current_status: form.current_status,
        currently_at: form.currently_at.trim() || null,
        designation: form.designation.trim() || null,
        message_1: form.message_1.trim() || null,
        message_2: form.message_2.trim() || null,
        consent_given: true,
        approval_status: 'pending',
      });
      if (insErr) throw insErr;

      setSubmitted(true);
    } catch (err) {
      console.error(err);
      setError('Something went wrong: ' + (err instanceof Error ? err.message : 'unknown error'));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) return <SuccessScreen />;

  const isLast = step === STEPS.length - 1;

  return (
    <main className="container container--narrow">
      <div className="card fade-up">
        <StepBar step={step} />

        <p className="step-label">Step {step + 1} of {STEPS.length}</p>

        {error && <div className="alert alert--error">{error}</div>}

        <form onSubmit={handleFormSubmit}>
          {/* remounting on step change replays the entrance animation */}
          <div key={step} className="fade-up">
            {step === 0 && <StepYou form={form} update={update} />}
            {step === 1 && <StepStudies form={form} update={update} collegeOptions={collegeOptions} />}
            {step === 2 && <StepNow form={form} update={update} orgOptions={orgOptions} />}
            {step === 3 && <StepAdvice form={form} update={update} />}
          </div>

          <div className="wizard-nav">
            {step > 0 && (
              <button type="button" className="btn btn--ghost" onClick={goBack}>
                <span className="btn__inner">← Back</span>
              </button>
            )}
            <button type="submit" className="btn btn--neutral" disabled={submitting}>
              <span className="btn__inner">
                {submitting ? (
                  <><span className="spinner spinner--neutral" /> Submitting…</>
                ) : isLast ? (
                  'Submit my profile ✨'
                ) : (
                  'Continue →'
                )}
              </span>
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

/* ----- Steps -------------------------------------------------------------- */

type StepProps = {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
};

function StepYou({ form, update }: StepProps) {
  return (
    <>
      <h2 className="step-title">Let&apos;s start with you 👋</h2>
      <p className="step-sub">Just the basics, takes 20 seconds.</p>

      <FloatingField label="Full name" value={form.full_name} onChange={(v) => update('full_name', v)} autoFocus />

      <div className="two-col">
        <FloatingField label="Admission number" value={form.admission_number} onChange={(v) => update('admission_number', v)} />
        <FloatingField label="Graduating year (Class of)" type="number" max={CURRENT_YEAR} value={form.class_of} onChange={(v) => update('class_of', v)} />
      </div>

      <div className="field">
        <label>Stream at school</label>
        <Chips options={STREAMS} value={form.stream} onChange={(v) => update('stream', v)} />
      </div>
    </>
  );
}

function StepStudies({ form, update, collegeOptions }: StepProps & { collegeOptions: string[] }) {
  return (
    <>
      <h2 className="step-title">What did you study? 🎓</h2>
      <p className="step-sub">Tap the area that fits, details are optional.</p>

      <div className="field">
        <label>Broad area</label>
        <div className="chips">
          {CATEGORIES.map((c) => (
            <button
              type="button"
              key={c.key}
              className={`chip${form.field === c.label ? ' chip--active' : ''}`}
              onClick={() => update('field', c.label)}
            >
              <span className="chip__emoji">{c.emoji}</span>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <FloatingField
        label="College / University"
        hint="start typing to search"
        value={form.college_name}
        onChange={(v) => update('college_name', v)}
        list="college-list"
      />
      <datalist id="college-list">
        {collegeOptions.map((name) => <option key={name} value={name} />)}
      </datalist>

      <div className="field">
        <label>Degree <span className="hint">pick one or type your own</span></label>
        <Chips options={DEGREES} value={form.degree} onChange={(v) => update('degree', v)} wrapText />
        <FloatingField label="Degree" value={form.degree} onChange={(v) => update('degree', v)} style={{ marginTop: 10 }} />
      </div>

      <div className="two-col">
        <FloatingField label="Branch / Department" value={form.branch} onChange={(v) => update('branch', v)} />
        <FloatingField
          label="Admission rank"
          hint="optional"
          type="number"
          min={1}
          step={1}
          value={form.admission_rank}
          onChange={(v) => update('admission_rank', v.replace(/[^\d]/g, ''))}
        />
      </div>

      <div className="field">
        <label>How did you get in?</label>
        <Chips options={ROUTES} value={form.admission_route} onChange={(v) => update('admission_route', v)} />
      </div>
    </>
  );
}

function StepNow({ form, update, orgOptions }: StepProps & { orgOptions: string[] }) {
  return (
    <>
      <h2 className="step-title">What are you up to now? 💼</h2>
      <p className="step-sub">So juniors know where seniors end up.</p>

      <div className="field">
        <label>Current status</label>
        <Chips options={STATUSES} value={form.current_status} onChange={(v) => update('current_status', v)} />
      </div>

      <div className="two-col">
        <div>
          <FloatingField label="Currently at" hint="org / institute" value={form.currently_at} onChange={(v) => update('currently_at', v)} list="org-list" />
          <datalist id="org-list">
            {orgOptions.map((o) => <option key={o} value={o} />)}
          </datalist>
        </div>
        <FloatingField label="Role / Designation" value={form.designation} onChange={(v) => update('designation', v)} />
      </div>

      <FloatingField label="LinkedIn" hint="optional, shown publicly" type="url" value={form.linkedin_url} onChange={(v) => update('linkedin_url', v)} />

      <div className="two-col">
        <FloatingField label="Email" hint="never shown publicly" type="email" value={form.personal_email} onChange={(v) => update('personal_email', v)} />
        <FloatingField
          label="Phone (10 digits)"
          hint="never shown publicly"
          type="tel"
          inputMode="numeric"
          maxLength={10}
          value={form.phone_number}
          onChange={(v) => update('phone_number', v.replace(/\D/g, '').slice(0, 10))}
        />
      </div>
    </>
  );
}

function StepAdvice({ form, update }: StepProps) {
  return (
    <>
      <h2 className="step-title">Leave something behind ✨</h2>
      <p className="step-sub">Optional, but juniors love this part.</p>

      <div className="field">
        <label>One thing I wish I knew in Class 11/12</label>
        <textarea value={form.message_1} onChange={(e) => update('message_1', e.target.value)} placeholder="Your honest take…" />
      </div>

      <div className="field">
        <label>One tip for someone in my stream</label>
        <textarea value={form.message_2} onChange={(e) => update('message_2', e.target.value)} placeholder="Keep it short and real…" />
      </div>

      <div className="two-col">
        <div className="field">
          <label>Show your photo publicly?</label>
          <Chips options={['no', 'yes']} value={form.show_photo} onChange={(v) => update('show_photo', v as 'yes' | 'no')} emojiMap={{ no: '🙈', yes: '📸' }} />
        </div>
        <div className="field">
          <label>Upload photo <span className="hint">optional</span></label>
          <label className="upload">
            <span className="upload__blob" />
            <span className="upload__inner">
              <span className="upload__icon">📷</span>
              <span className="upload__text">
                <span className="upload__title">{form.photo_file ? 'Change photo' : 'Choose a photo'}</span>
                <span className="upload__hint">JPG, PNG or WEBP · up to 5MB</span>
              </span>
            </span>
            <input type="file" accept="image/*" onChange={(e) => update('photo_file', e.target.files?.[0] ?? null)} />
          </label>
          {form.photo_file && <div className="upload__filename">✓ {form.photo_file.name}</div>}
        </div>
      </div>

      <div className="consent">
        <label className="cbox">
          <input type="checkbox" id="consent" checked={form.consent_given} onChange={(e) => update('consent_given', e.target.checked)} />
          <span className="cbox__mark" />
        </label>
        <label htmlFor="consent">
          I agree that my name and the details I chose to share can be displayed
          publicly on the Veveaham alumni site. My email and phone number will
          never be shown publicly.
        </label>
      </div>
    </>
  );
}

/* ----- Small pieces ------------------------------------------------------- */

function FloatingField({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  list,
  autoFocus,
  style,
  inputMode,
  maxLength,
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
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const [focused, setFocused] = useState(false);
  // Driven entirely by React state (focus + actual value) rather than the
  // CSS-only `:placeholder-shown` trick, which browsers can leave stale
  // after autofill and causes the label to sit on top of the typed value.
  const active = focused || value.trim().length > 0;
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
        inputMode={inputMode}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
      />
      <label htmlFor={id}>
  {label}
</label>
{hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Chips({
  options,
  value,
  onChange,
  emojiMap,
  wrapText,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  emojiMap?: Record<string, string>;
  wrapText?: boolean;
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
          {emojiMap?.[o] && <span className="chip__emoji">{emojiMap[o]}</span>}
          {wrapText ? o : o.charAt(0).toUpperCase() + o.slice(1)}
        </button>
      ))}
    </div>
  );
}

function StepBar({ step }: { step: number }) {
  return (
    <div className="steps" aria-hidden>
      {STEPS.map((_, i) => (
        <div key={i} className={`step${i < step ? ' step--done' : ''}${i === step ? ' step--active' : ''}`}>
          <div className="step__dot">{i < step ? '✓' : i + 1}</div>
          {i < STEPS.length - 1 && (
            <div className="step__bar" style={{ '--fill': i < step ? '100%' : '0%' } as React.CSSProperties} />
          )}
        </div>
      ))}
    </div>
  );
}

function SuccessScreen() {
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const shareText = 'Register yourself on the Veveaham Alumni site!';
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`;
  const email = `mailto:?subject=${encodeURIComponent('Veveaham Alumni Registration')}&body=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`;

  return (
    <main className="container container--narrow">
      <div className="card fade-up" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 56, animation: 'pop 0.5s var(--ease)' }}>🎉</div>
        <h1>You&apos;re in!</h1>
        <p className="subtitle">
          Your details are submitted and waiting for admin approval. Once approved,
          your profile appears in the directory.
        </p>
        <p style={{ fontWeight: 600 }}>Pass it on, share the link with a friend or senior:</p>
        <div className="chips" style={{ justifyContent: 'center', marginTop: 16 }}>
          <a className="btn btn--plain btn--plain-neutral" href={whatsapp} target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>
          <a className="btn btn--plain btn--plain-neutral" href={email}>📧 Email</a>
          <button
            type="button"
            className="btn btn--plain btn--plain-neutral"
            onClick={() => {
              navigator.clipboard.writeText(shareUrl);
              alert('Link copied! Paste it in an Instagram DM or story.');
            }}
          >
            📷 Copy link
          </button>
        </div>
      </div>
    </main>
  );
}
