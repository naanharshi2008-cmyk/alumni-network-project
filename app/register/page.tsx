// redeploy trigger
'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import { commonOrganizations } from '../../lib/commonOrganizations';
import { CATEGORIES } from '../../lib/types';

interface FormState {
  full_name: string;
  username: string;
  password_val: string;
  school_name: string;
  show_photo: 'yes' | 'no';
  photo_file: File | null;
  class_of: string;
  stream: string;
  stream_other: string;
  personal_email: string;
  phone_country_code: string;
  phone_number: string;
  linkedin_url: string;
  college_name: string;
  degree: string;
  degree_other: string;
  branch: string;
  field: string;
  field_other: string;
  admission_mode: 'Entrance Exam' | 'Board Marks' | 'Other';
  admission_mode_other: string;
  admission_route: string;
  admission_route_other: string;
  admission_rank: string;
  board_marks: string;
  board_cutoff: string;
  current_status: string;
  current_status_other: string;
  expected_finish_year: string;
  currently_at: string;
  designation: string;
  message_1: string;
  message_2: string;
  consent_given: boolean;
}

// Same shape as the Profile page's repeatable entries -- kept optional here
// so registration itself stays quick; people can also add these later from
// their profile.
interface HigherStudyEntry {
  degree_name: string;
  institution: string;
  start_year: string;
  finish_year: string;
}
interface WorkExperienceEntry {
  company: string;
  role: string;
  start_year: string;
  end_year: string;
  is_current: boolean;
}
const emptyHigherStudy = (): HigherStudyEntry => ({ degree_name: '', institution: '', start_year: '', finish_year: '' });
const emptyWorkExperience = (): WorkExperienceEntry => ({ company: '', role: '', start_year: '', end_year: '', is_current: false });

const initialForm: FormState = {
  full_name: '',
  username: '',
  password_val: '',
  school_name: 'Veveaham Group Of Schools',
  show_photo: 'no',
  photo_file: null,
  class_of: '',
  stream: 'Bio-Maths',
  stream_other: '',
  personal_email: '',
  phone_country_code: '+91',
  phone_number: '',
  linkedin_url: '',
  college_name: '',
  degree: '',
  degree_other: '',
  branch: '',
  field: '',
  field_other: '',
  admission_mode: 'Entrance Exam',
  admission_mode_other: '',
  admission_route: '',
  admission_route_other: '',
  admission_rank: '',
  board_marks: '',
  board_cutoff: '',
  current_status: '',
  current_status_other: '',
  expected_finish_year: '',
  currently_at: '',
  designation: '',
  message_1: '',
  message_2: '',
  consent_given: false,
};

const CURRENT_YEAR = new Date().getFullYear();
// Fake internal domain used to build a Supabase Auth email from an alumnus's
// username - keeps their login identity separate from their real (optional)
// personal email. Must match the same constant used in app/login/page.tsx.
const ALUMNI_LOGIN_DOMAIN = 'veveaham-alumni-network.com';
const STEPS = ['Account', 'You', 'Studies', 'Now', 'Advice'];
const STREAMS = ['Bio-Maths', 'CS-Maths', 'Commerce (Business & Finance)', 'Other'];
const ROUTES = [
  'JEE Main', 'JEE Advanced', 'NEET', 'CUET', 'BITSAT', 'VITEEE', 'SRMJEEE',
  'COMEDK', 'KCET', 'MHT-CET', 'WBJEE', 'KEAM', 'CLAT', 'Other'
];
const STATUSES = ['Studying UG', 'Studying PG', 'Higher Studies', 'Working', 'Entrepreneur', 'Preparing', 'On Break', 'Other'];
const DEGREES = ['BTech', 'BE', 'BSc', 'MBBS', 'BCom', 'BA', 'BArch', 'LLB', 'BBA', 'BCA'];
const COUNTRY_CODES = ['+91', '+1', '+44', '+61', '+971', '+65', '+49', '+33', '+81', '+86'];
const SCHOOLS = ['Veveaham Hr. Sec. School', 'Veveaham Prime Academy'];

export default function RegisterPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  // A ref (not state) so a double-click can't slip through before React
  // re-renders the disabled button. State updates are async and can lag
  // by a frame; this lock is checked and set synchronously, so two rapid
  // clicks can never both start a submission.
  const submitLockRef = useRef(false);

  const [orgOptions, setOrgOptions] = useState<string[]>(commonOrganizations);
  const [tagOptions, setTagOptions] = useState<Record<string, string[]>>({});

  // Optional "add now" sections -- collapsed by default so the form stays
  // quick; people can also add these later from their profile instead.
  const [showHigherStudies, setShowHigherStudies] = useState(false);
  const [higherStudies, setHigherStudies] = useState<HigherStudyEntry[]>([emptyHigherStudy()]);
  const [showWorkExperience, setShowWorkExperience] = useState(false);
  const [workExperience, setWorkExperience] = useState<WorkExperienceEntry[]>([emptyWorkExperience()]);

  function updateHigherStudy(index: number, patch: Partial<HigherStudyEntry>) {
    setHigherStudies((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }
  function addHigherStudy() {
    setHigherStudies((prev) => [...prev, emptyHigherStudy()]);
  }
  function removeHigherStudy(index: number) {
    setHigherStudies((prev) => prev.filter((_, i) => i !== index));
  }

  function updateWorkExperience(index: number, patch: Partial<WorkExperienceEntry>) {
    setWorkExperience((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }
  function addWorkExperience() {
    setWorkExperience((prev) => [...prev, emptyWorkExperience()]);
  }
  function removeWorkExperience(index: number) {
    setWorkExperience((prev) => prev.filter((_, i) => i !== index));
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    (async () => {
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
  useEffect(() => {
  if (!isSupabaseConfigured) return;
  (async () => {
    const { data } = await supabase.from('field_options').select('category, value');
    if (data) {
      const grouped: Record<string, string[]> = {};
      for (const row of data as { category: string; value: string }[]) {
        (grouped[row.category] ??= []).push(row.value);
      }
      setTagOptions(grouped);
    }
  })();
}, []);
  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const URL_RE = /^https?:\/\/.+/i;

  function validateStep(s: number): string {
    if (s === 0) {
      if (!form.username.trim()) return 'Please choose a username.';
      if (form.username.trim().length < 3) return 'Username must be at least 3 characters.';
      if (!form.password_val || form.password_val.length < 6) return 'Password must be at least 6 characters.';
    }
    if (s === 1) {
      if (!form.full_name.trim()) return 'Please tell us your full name.';
      if (form.full_name.trim().length < 2) return 'Full name looks too short.';
      const yr = parseInt(form.class_of, 10);
      if (!form.class_of || Number.isNaN(yr) || yr < 1960 || yr > CURRENT_YEAR)
        return `Enter a valid graduating year, ${CURRENT_YEAR} or earlier.`;
    }
    if (s === 2) {
      if (!form.college_name.trim()) return 'Tell us which college or university you attended.';
      if (!form.degree.trim()) return 'Pick or type your degree.';
      if (!form.field.trim()) return 'Select your field of study.';
      if (form.admission_mode === 'Entrance Exam' && !form.admission_route.trim())
        return 'Select which entrance exam you took.';
      
      if (form.admission_mode === 'Entrance Exam' && form.admission_rank.trim()) {
        const rank = parseInt(form.admission_rank, 10);
        if (Number.isNaN(rank) || rank <= 0) return 'Admission rank must be a positive number.';
      }
      if (form.admission_mode === 'Board Marks' && form.board_marks.trim()) {
        const marks = parseFloat(form.board_marks);
        if (Number.isNaN(marks) || marks < 0 || marks > 100) return 'Board marks must be between 0 and 100.';
      }
    }
    if (s === 3) {
      if (!form.current_status.trim()) return 'Please select your current status.';
      if (form.linkedin_url.trim() && !URL_RE.test(form.linkedin_url.trim()))
        return 'Enter a valid LinkedIn URL, starting with https://';
      if (!form.personal_email.trim() || !EMAIL_RE.test(form.personal_email.trim()))
        return 'Enter a valid email address.';
      if (!form.phone_number.trim() || form.phone_number.trim().length < 7)
        return 'Enter a valid phone number.';
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

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step < STEPS.length - 1) {
      goNext();
    } else {
      void submit();
    }
  }

  async function submit() {
    // Hard stop against double-submission - checked and set synchronously,
    // before any async work or state updates happen.
    if (submitLockRef.current) return;
    submitLockRef.current = true;

    setError('');
    if (!isSupabaseConfigured) {
      setError('Supabase isn’t connected yet, add your keys to .env.local to enable submissions.');
      submitLockRef.current = false;
      return;
    }
    if (!form.consent_given) {
      setError('Please tick the consent box so we can show your profile.');
      submitLockRef.current = false;
      return;
    }

    setSubmitting(true);
    try {
      // 1. Check if username is already taken in the alumni database
      const { data: userCheck, error: userCheckErr } = await supabase
        .from('alumni')
        .select('username')
        .eq('username', form.username.trim())
        .maybeSingle();

      // A real query failure (e.g. a missing column) must not be treated
      // the same as "no matching row" - surface it clearly instead of
      // silently letting a broken check pass through.
      if (userCheckErr) throw userCheckErr;

      if (userCheck) {
        throw new Error('This username is already taken. Please choose another one.');
      }

      // 2. Sign up user via Supabase Auth
      // We use a fake internal email built from the username rather than
      // their real personal email - real email is optional on this form,
      // and Supabase's free-tier mailer has a very low sending limit that
      // real registrations would quickly hit. This keeps login identity
      // fully decoupled from whatever email (if any) they typed in.
      const authEmail = `${form.username.trim()}@${ALUMNI_LOGIN_DOMAIN}`;
      let userId: string;

      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: authEmail,
        password: form.password_val,
        options: {
          data: {
            username: form.username.trim(),
            full_name: form.full_name.trim(),
          }
        }
      });

      if (authErr) {
        // "Already registered" can legitimately mean THIS SAME PERSON tried
        // before, the login account got created, but saving their profile
        // failed right after (e.g. a database constraint error) - leaving
        // an orphaned account with no profile. Rather than dead-ending
        // here, try signing in with the exact credentials they just typed:
        // if that succeeds, it's safely their own account and we continue;
        // if it fails too, the username genuinely belongs to someone else.
        const isDuplicate = /already registered|already exists/i.test(authErr.message);
        if (!isDuplicate) throw authErr;

        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: form.password_val,
        });

        if (signInErr || !signInData.user) {
          throw new Error('This username is already taken. Please choose another one.');
        }
        userId = signInData.user.id;
      } else {
        if (!authData.user) throw new Error('Auth registration failed.');
        userId = authData.user.id;
      }

      // 3. Handle photo upload if present
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
        const extMatch = file.name.match(/\.([a-zA-Z0-9]{1,5})$/);
        const ext = (extMatch?.[1] ?? 'jpg').toLowerCase();
        const safeUsername = form.username.trim().replace(/[^a-zA-Z0-9-_]/g, '_');
        const fileName = `${safeUsername}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('photos').upload(fileName, file, {
          contentType: file.type,
        });
        if (upErr) throw upErr;
        photoUrl = supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;
      }

      // 4. Look up the college the person typed against the (now Kaggle-backed)
      // colleges table. We no longer create new rows here - with 47k+ real
      // colleges already loaded, a typed name that doesn't match is more
      // likely a typo or an genuinely obscure institution than something
      // that needs a brand-new row, and letting any visitor insert into a
      // shared reference table was the source of an earlier RLS bug. If it
      // doesn't match, we keep the raw text so admin can review and match
      // or add it manually later.
      let collegeId: string | number | null = null;
      const typedCollege = form.college_name.trim();
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

      // Map values
      const finalStream = form.stream === 'Other' && form.stream_other.trim() ? form.stream_other.trim() : form.stream;
      const finalDegree = form.degree === 'Other' && form.degree_other.trim() ? form.degree_other.trim() : form.degree;
      const finalField = form.field === 'Other' && form.field_other.trim() ? form.field_other.trim() : form.field;

      let finalRoute = 'Direct';
      if (form.admission_mode === 'Entrance Exam') {
        finalRoute = form.admission_route === 'Other' && form.admission_route_other.trim() ? form.admission_route_other.trim() : form.admission_route;
      } else if (form.admission_mode === 'Board Marks') {
        finalRoute = 'Board Marks';
      } else if (form.admission_mode === 'Other') {
        finalRoute = form.admission_mode_other.trim() || 'Other';
      }

      const finalStatus = form.current_status === 'Other' && form.current_status_other.trim() ? form.current_status_other.trim() : form.current_status;

      // 5. Insert profile row with link to auth user
      const { data: insertedAlumni, error: insErr } = await supabase.from('alumni').insert({
        user_id: userId,
        username: form.username.trim(),
        full_name: form.full_name.trim(),
        school_name: form.school_name,
        show_photo: !!photoUrl,
        photo_url: photoUrl,
        class_of: parseInt(form.class_of, 10),
        stream: finalStream,

        personal_email: form.personal_email.trim() || null,
        phone_country_code: form.phone_number.trim() ? form.phone_country_code : null,
        phone_number: form.phone_number.trim() || null,
        linkedin_url: form.linkedin_url.trim() || null,
        college_id: collegeId,
        college_name_raw: typedCollege || null,
        degree: finalDegree.trim() || null,
        branch: form.branch.trim() || null,
        field: finalField.trim() || null,
        admission_route: finalRoute,
        admission_rank: form.admission_mode === 'Entrance Exam' ? (form.admission_rank.trim() || null) : null,
        board_marks: form.admission_mode === 'Board Marks' ? (form.board_marks.trim() || null) : null,
        board_cutoff: form.admission_mode === 'Board Marks' ? (form.board_cutoff.trim() || null) : null,
        current_status: finalStatus,
        expected_finish_year: (finalStatus.toLowerCase().includes('studying') || finalStatus.toLowerCase().includes('higher studies') || finalStatus.toLowerCase().includes('preparing')) && form.expected_finish_year.trim() ? parseInt(form.expected_finish_year, 10) : null,
        currently_at: form.currently_at.trim() || null,
        designation: form.designation.trim() || null,
        message_1: form.message_1.trim() || null,
        message_2: form.message_2.trim() || null,
        consent_given: true,
        approval_status: 'pending',
        modification_status: 'none'
      }).select('id').single();

      if (insErr) throw insErr;

      // 5b. If they chose "Add now" for higher studies and/or work
      // experience, save those too. Anything left blank (or if they picked
      // "add later") is simply skipped -- they can fill it in from their
      // profile afterwards.
      const newAlumniId = insertedAlumni?.id;
      if (newAlumniId && showHigherStudies) {
        const studiesToInsert = higherStudies
          .filter((s) => s.degree_name.trim())
          .map((s) => ({
            alumni_id: newAlumniId,
            degree_name: s.degree_name.trim(),
            institution: s.institution.trim() || null,
            start_year: s.start_year ? parseInt(s.start_year, 10) : null,
            finish_year: s.finish_year ? parseInt(s.finish_year, 10) : null,
          }));
        if (studiesToInsert.length) {
          await supabase.from('higher_studies').insert(studiesToInsert);
        }
      }
      if (newAlumniId && showWorkExperience) {
        const workToInsert = workExperience
          .filter((w) => w.company.trim())
          .map((w) => ({
            alumni_id: newAlumniId,
            company: w.company.trim(),
            role: w.role.trim() || null,
            start_year: w.start_year ? parseInt(w.start_year, 10) : null,
            end_year: w.is_current ? null : (w.end_year ? parseInt(w.end_year, 10) : null),
            is_current: w.is_current,
          }));
        if (workToInsert.length) {
          await supabase.from('work_experience').insert(workToInsert);
        }
      }

      // Notify admin
      fetch('/api/notify-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.full_name.trim(),
          classOf: form.class_of,
          currentStatus: form.current_status,
        }),
      }).catch(() => {});

      setSubmitted(true);
    } catch (err) {
      console.error(err);
      // Supabase/Postgrest errors are plain objects with a `message`
      // property - they are NOT real `Error` instances, so the old check
      // here (`err instanceof Error`) silently missed them and always
      // fell back to a generic message, hiding the real reason.
      const realMessage =
        err instanceof Error
          ? err.message
          : (err && typeof err === 'object' && 'message' in err)
            ? String((err as { message: unknown }).message)
            : null;
      setError(realMessage || 'Something went wrong. Please try again.');
      // Only release the lock on failure, so the person can correct
      // something and retry. On success there's nothing left to submit.
      submitLockRef.current = false;
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
          <div key={step} className="fade-up">
            {step === 0 && <StepAccount form={form} update={update} />}
            {step === 1 && <StepYou form={form} update={update} />}
            {step === 2 && <StepStudies form={form} update={update} />}
            {step === 3 && (
              <StepNow
                form={form}
                update={update}
                orgOptions={orgOptions}
                showHigherStudies={showHigherStudies}
                setShowHigherStudies={setShowHigherStudies}
                higherStudies={higherStudies}
                updateHigherStudy={updateHigherStudy}
                addHigherStudy={addHigherStudy}
                removeHigherStudy={removeHigherStudy}
                showWorkExperience={showWorkExperience}
                setShowWorkExperience={setShowWorkExperience}
                workExperience={workExperience}
                updateWorkExperience={updateWorkExperience}
                addWorkExperience={addWorkExperience}
                removeWorkExperience={removeWorkExperience}
              />
            )}
            {step === 4 && <StepAdvice form={form} update={update} />}
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

function StepAccount({ form, update }: StepProps) {
  return (
    <>
      <h2 className="step-title">Create your account 🔒</h2>
      <p className="step-sub">You will use these details to edit your profile later.</p>
      
      <FloatingField label="Choose Username" value={form.username} onChange={(v) => update('username', v.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} autoFocus />
      <FloatingField label="Choose Password" type="password" revealable value={form.password_val} onChange={(v) => update('password_val', v)} />

      {/* TEMPORARY testing helper - remove this button before real students
          start using the site. Fills in a guaranteed-unique username/password
          so repeated test runs never collide with an earlier test account. */}
      <button
        type="button"
        onClick={() => {
          const rand = Math.random().toString(36).slice(2, 8);
          update('username', `test_${rand}`);
          update('password_val', `Test${rand}!`);
        }}
        className="btn btn--ghost"
        style={{ marginTop: 8, fontSize: '0.8rem' }}
      >
        <span className="btn__inner">🎲 Fill random test account</span>
      </button>
    </>
  );
}

function StepYou({ form, update }: StepProps) {
  return (
    <>
      <h2 className="step-title">Tell us about you 👋</h2>
      <p className="step-sub">Let's associate your high school details.</p>

      <div className="field">
        <label>Which school did you attend?</label>
        <Chips options={SCHOOLS} value={form.school_name} onChange={(v) => update('school_name', v)} />
      </div>

      <FloatingField label="Full name" value={form.full_name} onChange={(v) => update('full_name', v)} />

      <FloatingField label="Graduating year (Class of)" type="number" max={CURRENT_YEAR} value={form.class_of} onChange={(v) => update('class_of', v)} />

      <div className="field">
        <label>Stream at school</label>
        <OtherAwareChips
          options={STREAMS}
          value={form.stream}
          onChange={(v) => update('stream', v)}
          otherValue={form.stream_other}
          onOtherChange={(v) => update('stream_other', v)}
          otherPlaceholder="Please specify your stream"
        />
      </div>
    </>
  );
}

function StepStudies({ form, update }: StepProps) {
  return (
    <>
      <h2 className="step-title">What did you study? 🎓</h2>
      <p className="step-sub">Select the area that fits your higher education.</p>

      <div className="field">
        <label>Broad area</label>
        <select value={form.field} onChange={(e) => update('field', e.target.value)}>
          <option value="" disabled hidden>Select your field</option>
          {CATEGORIES.map((c) => <option key={c.key} value={c.label}>{c.emoji} {c.label}</option>)}
        </select>
        {form.field === 'Other' && (
          <FloatingField
            label="Please specify"
            value={form.field_other}
            onChange={(v) => update('field_other', v)}
            style={{ marginTop: 10 }}
          />
        )}
      </div>

      <CollegeSearchField
        value={form.college_name}
        onChange={(v) => update('college_name', v)}
      />

      <div className="field">
        <label>Degree</label>
        <OtherAwareSelect
          label="Degree"
          options={DEGREES}
          value={form.degree}
          onChange={(v) => update('degree', v)}
          otherValue={form.degree_other}
          onOtherChange={(v) => update('degree_other', v)}
          otherPlaceholder="Please specify your degree"
        />
      </div>

      <FloatingField label="Branch / Department" value={form.branch} onChange={(v) => update('branch', v)} />

      <div className="field">
        <label>How did you get in?</label>
        <Chips
          options={['Entrance Exam', 'Board Marks', 'Other']}
          value={form.admission_mode}
          onChange={(v) => update('admission_mode', v as any)}
        />
        {form.admission_mode === 'Other' && (
          <FloatingField
            label="Please specify"
            value={form.admission_mode_other}
            onChange={(v) => update('admission_mode_other', v)}
            style={{ marginTop: 10 }}
          />
        )}
      </div>

      {form.admission_mode === 'Entrance Exam' && (
        <>
          <div className="field" style={{ marginTop: 14 }}>
            <OtherAwareSelect
              label="Entrance Exam"
              options={ROUTES.filter((r) => r !== 'Other')}
              value={form.admission_route}
              onChange={(v) => update('admission_route', v)}
              otherValue={form.admission_route_other}
              onOtherChange={(v) => update('admission_route_other', v)}
              otherPlaceholder="Specify Entrance Exam"
            />
          </div>
          <FloatingField
            label="Admission rank"
            hint="optional"
            type="number"
            min={1}
            step={1}
            value={form.admission_rank}
            onChange={(v) => update('admission_rank', v.replace(/[^\d]/g, ''))}
          />
        </>
      )}

      {form.admission_mode === 'Board Marks' && (
        <div className="two-col" style={{ marginTop: 14 }}>
          <FloatingField
            label="Board marks (%)"
            hint="optional"
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={form.board_marks}
            onChange={(v) => update('board_marks', v)}
          />
          <FloatingField
            label="Cutoff"
            hint="if applicable"
            value={form.board_cutoff}
            onChange={(v) => update('board_cutoff', v)}
          />
        </div>
      )}
    </>
  );
}

function StepNow({
  form, update, orgOptions,
  showHigherStudies, setShowHigherStudies, higherStudies, updateHigherStudy, addHigherStudy, removeHigherStudy,
  showWorkExperience, setShowWorkExperience, workExperience, updateWorkExperience, addWorkExperience, removeWorkExperience,
}: StepProps & { orgOptions: string[] } & OptionalSectionsProps) { 
  return (
    <>
      <h2 className="step-title">What are you up to now? 💼</h2>
      <p className="step-sub">So juniors know where seniors end up.</p>

      <div className="field">
        <label>Current status</label>
        <select value={form.current_status} onChange={(e) => update('current_status', e.target.value)}>
          <option value="" disabled hidden>Select your current status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {form.current_status === 'Other' && (
          <FloatingField
            label="Please specify"
            value={form.current_status_other}
            onChange={(v) => update('current_status_other', v)}
            style={{ marginTop: 10 }}
          />
        )}
        {(form.current_status.toLowerCase().includes('studying') || form.current_status.toLowerCase().includes('higher studies') || form.current_status.toLowerCase().includes('preparing')) && (
          <FloatingField
            label="Expected to finish in"
            hint="year, optional"
            type="number"
            min={CURRENT_YEAR}
            max={CURRENT_YEAR + 6}
            value={form.expected_finish_year}
            onChange={(v) => update('expected_finish_year', v)}
            style={{ marginTop: 10 }}
          />
        )}
      </div>

      <div className="two-col">
        <div>
          <FloatingField label="Currently at" hint="org / institute, optional" value={form.currently_at} onChange={(v) => update('currently_at', v)} list="org-list" />
          <datalist id="org-list">
            {orgOptions.map((o) => <option key={o} value={o} />)}
          </datalist>
        </div>
        <FloatingField label="Role / Designation" hint="optional" value={form.designation} onChange={(v) => update('designation', v)} />
      </div>

      <div className="field" style={{ marginTop: 20 }}>
        <label>Higher studies <span className="hint">optional</span></label>
        <Chips options={['Add later', 'Add now']} value={showHigherStudies ? 'Add now' : 'Add later'} onChange={(v) => setShowHigherStudies(v === 'Add now')} />
        {showHigherStudies && (
          <div style={{ marginTop: 10 }}>
            {higherStudies.map((entry, i) => (
              <div key={i} className="entry-card">
                <FloatingField label="Degree" hint="e.g. MS, MBA, PhD" value={entry.degree_name} onChange={(v) => updateHigherStudy(i, { degree_name: v })} />
                <FloatingField label="Institution" hint="optional" value={entry.institution} onChange={(v) => updateHigherStudy(i, { institution: v })} style={{ marginTop: 8 }} />
                <div className="two-col" style={{ marginTop: 8 }}>
                  <FloatingField label="Start year" hint="optional" type="number" value={entry.start_year} onChange={(v) => updateHigherStudy(i, { start_year: v })} />
                  <FloatingField label="Finish year" type="number" value={entry.finish_year} onChange={(v) => updateHigherStudy(i, { finish_year: v })} />
                </div>
                {higherStudies.length > 1 && (
                  <button type="button" onClick={() => removeHigherStudy(i)} className="btn btn--ghost" style={{ marginTop: 10 }}>
                    <span className="btn__inner">Remove</span>
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addHigherStudy} className="btn btn--ghost btn--block">
              <span className="btn__inner">+ Add another degree</span>
            </button>
          </div>
        )}
      </div>

      <div className="field" style={{ marginTop: 20 }}>
        <label>Work experience <span className="hint">optional</span></label>
        <Chips options={['Add later', 'Add now']} value={showWorkExperience ? 'Add now' : 'Add later'} onChange={(v) => setShowWorkExperience(v === 'Add now')} />
        {showWorkExperience && (
          <div style={{ marginTop: 10 }}>
            {workExperience.map((entry, i) => (
              <div key={i} className="entry-card">
                <FloatingField label="Company / Organization" value={entry.company} onChange={(v) => updateWorkExperience(i, { company: v })} />
                <FloatingField label="Role" hint="optional" value={entry.role} onChange={(v) => updateWorkExperience(i, { role: v })} style={{ marginTop: 8 }} />
                <div className="two-col" style={{ marginTop: 8 }}>
                  <FloatingField label="Start year" hint="optional" type="number" value={entry.start_year} onChange={(v) => updateWorkExperience(i, { start_year: v })} />
                  {!entry.is_current && (
                    <FloatingField label="End year" hint="optional" type="number" value={entry.end_year} onChange={(v) => updateWorkExperience(i, { end_year: v })} />
                  )}
                </div>
                <label className="cbox-row" style={{ marginTop: 10 }}>
                  <span className="cbox">
                    <input type="checkbox" checked={entry.is_current} onChange={(e) => updateWorkExperience(i, { is_current: e.target.checked, end_year: '' })} />
                    <span className="cbox__mark" />
                  </span>
                  <span>I currently work here</span>
                </label>
                {workExperience.length > 1 && (
                  <button type="button" onClick={() => removeWorkExperience(i)} className="btn btn--ghost" style={{ marginTop: 10 }}>
                    <span className="btn__inner">Remove</span>
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addWorkExperience} className="btn btn--ghost btn--block">
              <span className="btn__inner">+ Add another job</span>
            </button>
          </div>
        )}
      </div>

      <FloatingField label="LinkedIn" hint="optional, shown publicly" type="url" value={form.linkedin_url} onChange={(v) => update('linkedin_url', v)} />

      <FloatingField label="Email" hint="never shown publicly" type="email" value={form.personal_email} onChange={(v) => update('personal_email', v)} />

      <div className="two-col">
        <FloatingSelect label="Country code" value={form.phone_country_code} onChange={(v) => update('phone_country_code', v)} options={COUNTRY_CODES} />
        <FloatingField
          label="Phone number"
          hint="never shown publicly"
          type="tel"
          value={form.phone_number}
          onChange={(v) => update('phone_number', v.replace(/\D/g, ''))}
        />
      </div>
    </>
  );
}

interface OptionalSectionsProps {
  showHigherStudies: boolean;
  setShowHigherStudies: (v: boolean) => void;
  higherStudies: HigherStudyEntry[];
  updateHigherStudy: (i: number, patch: Partial<HigherStudyEntry>) => void;
  addHigherStudy: () => void;
  removeHigherStudy: (i: number) => void;
  showWorkExperience: boolean;
  setShowWorkExperience: (v: boolean) => void;
  workExperience: WorkExperienceEntry[];
  updateWorkExperience: (i: number, patch: Partial<WorkExperienceEntry>) => void;
  addWorkExperience: () => void;
  removeWorkExperience: (i: number) => void;
}

function StepAdvice({ form, update }: StepProps) {
  return (
    <>
      <h2 className="step-title">Almost there ✨</h2>
      <p className="step-sub">Upload a photo so juniors recognize you, and leave some advice.</p>

      <div className="field" style={{ marginBottom: 24 }}>
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

      <div className="field">
        <label>One thing you'd tell your junior self?</label>
        <textarea 
          value={form.message_1} 
          onChange={(e) => update('message_1', e.target.value)} 
          placeholder="e.g. don't stress over one bad exam, or start applying early..." 
        />
      </div>

      <div className="consent" style={{ marginTop: 20 }}>
        <label className="cbox">
          <input type="checkbox" id="consent" checked={form.consent_given} onChange={(e) => update('consent_given', e.target.checked)} />
          <span className="cbox__mark" />
        </label>
        <label htmlFor="consent">
          I agree that my name and the details I chose to share can be displayed
          publicly on the Veveaham alumni site. My email and phone number will
          never be shown publicly. Your information will never be shared publicly without your concern.
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
  revealable,
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
  revealable?: boolean;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const active = focused || value.trim().length > 0;
  const effectiveType = revealable && revealed ? 'text' : type;
  return (
    <div className={`f-field${active ? ' f-field--active' : ''}`} style={style}>
      <input
        id={id}
        type={effectiveType}
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
        style={revealable ? { paddingRight: 44 } : undefined}
      />
      <label htmlFor={id}>
        {label}
      </label>
      {revealable && (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 0,
            cursor: 'pointer',
            fontSize: '1.1rem',
            color: 'var(--text-faint)',
            lineHeight: 1,
            padding: 4,
          }}
        >
          {revealed ? '🙈' : '👁️'}
        </button>
      )}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function FloatingSelect({
  label,
  value,
  onChange,
  options,
  style,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  style?: React.CSSProperties;
  placeholder?: string;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="f-field f-field--active" style={style}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {/* A real placeholder option - without this, an empty `value` that
            matches no option would make the browser silently DISPLAY the
            first real option (e.g. "BTech") even though nothing was
            actually chosen yet, which is exactly the bug being fixed. */}
        <option value="" disabled hidden>{placeholder ?? `Select ${label.toLowerCase()}`}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

// Live search-as-you-type against the full colleges table (47k+ rows),
// instead of the old approach of pre-loading a list into the browser - that
// approach was silently capped at Supabase's default 1000-row limit, so
// most colleges (anything past roughly the first letter of the alphabet)
// never showed up at all, no matter how well the data itself was cleaned.
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
    }, 300); // debounce so we're not firing a query on every keystroke
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
              onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur doesn't fire before click
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

function OtherAwareChips({
  options,
  value,
  onChange,
  otherValue,
  onOtherChange,
  otherPlaceholder = 'Please specify',
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  otherValue: string;
  onOtherChange: (v: string) => void;
  otherPlaceholder?: string;
}) {
  return (
    <>
      <Chips options={options} value={value} onChange={onChange} />
      {value === 'Other' && (
        <FloatingField
          label={otherPlaceholder}
          value={otherValue}
          onChange={onOtherChange}
          style={{ marginTop: 10 }}
        />
      )}
    </>
  );
}

// Same "Other -> type your own" pattern as OtherAwareChips, but as a clean
// dropdown instead of a wall of buttons - used where the option list is
// long (Degree, Entrance Exam) and chips would look cluttered.
function OtherAwareSelect({
  label,
  options,
  value,
  onChange,
  otherValue,
  onOtherChange,
  otherPlaceholder = 'Please specify',
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  otherValue: string;
  onOtherChange: (v: string) => void;
  otherPlaceholder?: string;
}) {
  const selectOptions = options.includes('Other') ? options : [...options, 'Other'];
  return (
    <>
      <FloatingSelect label={label} value={value} onChange={onChange} options={selectOptions} />
      {value === 'Other' && (
        <FloatingField
          label={otherPlaceholder}
          value={otherValue}
          onChange={onOtherChange}
          style={{ marginTop: 10 }}
        />
      )}
    </>
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
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== 'undefined' ? window.location.origin + '/register' : '';
  const shareText = 'Join the Veveaham Alumni network — add your own journey here:';
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`;
  const email = `mailto:?subject=${encodeURIComponent('Join the Veveaham Alumni network')}&body=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail (older browsers, no HTTPS) -- fail quietly,
      // the link is still shown in the field for a manual copy.
    }
  }

  return (
    <main className="container container--narrow">
      <div className="card fade-up" style={{ textAlign: 'center' }}>
        <div className="success-icon">
          <span>✓</span>
        </div>

        <h1 className="success-title">
          Registration Successful
        </h1>

        <p className="success-subtitle">
          Welcome to the Veveaham Alumni Network.
        </p>

        <p className="subtitle">
          Your profile has been submitted successfully and is awaiting admin approval.
          <br />
          You can log in anytime using your username and password.
        </p>

        <hr style={{ border: 'none', borderBottom: '1px solid var(--border)', margin: '28px 0 20px' }} />

        <h3 style={{ marginBottom: 4 }}>Help grow the alumni network</h3>

        <p className="hint" style={{ marginBottom: 14 }}>
          Invite your classmates and help build a stronger alumni community.
        </p>

        <div className="share-row">
          <div className="share-link">
            🔗 Your Alumni Invite Link
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={copyLink}
              className="btn btn--ghost"
            >
              <span className="btn__inner">
                {copied ? '✓ Copied' : 'Copy Link'}
              </span>
            </button>

            <a className="icon-share-btn" href={whatsapp} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" title="Share on WhatsApp"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0012.04 2zm0 1.67c2.24 0 4.35.87 5.93 2.45a8.24 8.24 0 012.42 5.85c0 4.55-3.7 8.25-8.35 8.25a8.3 8.3 0 01-4.24-1.16l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 01-1.27-4.4c0-4.55 3.7-8.25 8.3-8.28zm-4.6 4.7c-.17 0-.45.06-.68.32-.23.26-.9.88-.9 2.14 0 1.26.92 2.48 1.05 2.65.13.17 1.8 2.86 4.42 3.9 2.18.87 2.62.7 3.1.65.47-.04 1.5-.61 1.72-1.2.21-.59.21-1.1.15-1.2-.06-.11-.24-.17-.5-.3-.26-.13-1.5-.74-1.74-.82-.23-.09-.4-.13-.57.13-.17.26-.65.82-.8 1-.15.17-.29.19-.55.06-.26-.13-1.09-.4-2.07-1.28-.77-.68-1.28-1.53-1.43-1.79-.15-.26-.02-.4.11-.53.12-.12.26-.31.39-.47.13-.15.17-.26.26-.43.09-.17.04-.33-.02-.46-.06-.13-.57-1.4-.79-1.9-.2-.5-.42-.43-.57-.44l-.48-.01z"/></svg></a>
            <a className="icon-share-btn" href={email} aria-label="Share via Email" title="Share via Email"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></svg></a>
          </div>
        </div> 

        <div className="success-next">
          <h3>What happens next?</h3>

          <div className="next-item">
            <span>1.</span> Your profile will be reviewed by an administrator.
          </div>

          <div className="next-item">
            <span>2.</span> Once approved, you'll appear in the alumni directory.
          </div>

          <div className="next-item">
            <span>3.</span> You can log in anytime using your username and password.
          </div>
        </div>

        <div className="success-login">
          <a className="success-login-btn" href="/login">
            Continue to Login →
          </a>
        </div>
      </div>
    </main>
  );
}