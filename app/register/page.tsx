'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import EntitySearchField from '../../lib/EntitySearchField';
import { cleanFreeText, cleanProperNoun } from '../../lib/text';
import { fetchApprovedOptions, proposeOption } from '../../lib/publicData';
import {
  SCHOOLS, STREAMS, DEGREES, ADMISSION_ROUTES, STATUSES, SCHOOL_BOARDS,
  COUNTRY_CODES, OTHER_OPTION, isInProgressStatus, mergeOptions, resolveValue,
} from '../../lib/options';
import { CATEGORIES } from '../../lib/types';

/* ─────────────────────────────────────────────────────────────────────────
   Form model
───────────────────────────────────────────────────────────────────────── */
interface FormState {
  username: string;
  password_val: string;
  full_name: string;
  school_name: string;
  school_board: string;
  school_board_other: string;
  class_of: string;
  stream: string;
  stream_other: string;
  field: string;
  field_other: string;
  college_name: string;
  degree: string;
  degree_other: string;
  branch: string;
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
  personal_email: string;
  phone_country_code: string;
  phone_number: string;
  linkedin_url: string;
  message_1: string;
  photo_file: File | null;
  consent_given: boolean;
}

interface HigherStudyEntry { degree_name: string; institution: string; start_year: string; finish_year: string; }
interface WorkExperienceEntry { company: string; role: string; start_year: string; end_year: string; is_current: boolean; }

const emptyHigherStudy = (): HigherStudyEntry => ({ degree_name: '', institution: '', start_year: '', finish_year: '' });
const emptyWorkExperience = (): WorkExperienceEntry => ({ company: '', role: '', start_year: '', end_year: '', is_current: false });

const initialForm: FormState = {
  username: '', password_val: '',
  full_name: '', school_name: '', school_board: '', school_board_other: '',
  class_of: '', stream: '', stream_other: '',
  field: '', field_other: '', college_name: '', degree: '', degree_other: '', branch: '',
  admission_route: '', admission_route_other: '', admission_rank: '', board_marks: '', board_cutoff: '',
  current_status: '', current_status_other: '', expected_finish_year: '',
  currently_at: '', designation: '',
  personal_email: '', phone_country_code: '+91', phone_number: '', linkedin_url: '',
  message_1: '', photo_file: null, consent_given: false,
};

const CURRENT_YEAR = new Date().getFullYear();
// Internal domain used to build a Supabase Auth email from a username, so login
// never depends on the personal email. Must match app/login/page.tsx.
const ALUMNI_LOGIN_DOMAIN = 'veveaham-alumni-network.com';

const STEPS = [
  { title: 'Account', blurb: 'So you can edit your profile later.' },
  { title: 'School', blurb: 'Your Veveaham years.' },
  { title: 'Studies', blurb: 'Where you went after school.' },
  { title: 'Now', blurb: 'What you are doing today.' },
  { title: 'Finish', blurb: 'A photo, some advice, and you are done.' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/i;

/* ─────────────────────────────────────────────────────────────────────────
   Validation — one rule set, used both per-field (on blur) and per-step.
───────────────────────────────────────────────────────────────────────── */
type FieldKey = keyof FormState;

function validateField(key: FieldKey, form: FormState): string {
  const val = (v: unknown) => String(v ?? '').trim();
  switch (key) {
    case 'username': {
      const v = val(form.username);
      if (!v) return 'Choose a username.';
      if (v.length < 3) return 'At least 3 characters.';
      return '';
    }
    case 'password_val':
      return form.password_val.length < 6 ? 'At least 6 characters.' : '';
    case 'full_name': {
      const v = val(form.full_name);
      if (!v) return 'Please tell us your name.';
      if (v.length < 2) return 'That looks too short.';
      return '';
    }
    case 'school_name':
      return val(form.school_name) ? '' : 'Pick your school.';
    case 'class_of': {
      const v = val(form.class_of);
      if (!v) return 'Which year did you finish?';
      const yr = parseInt(v, 10);
      if (Number.isNaN(yr) || yr < 1960 || yr > CURRENT_YEAR) return `Enter a year between 1960 and ${CURRENT_YEAR}.`;
      return '';
    }
    case 'stream':
      if (!val(form.stream)) return 'Pick your stream.';
      if (form.stream === OTHER_OPTION && !val(form.stream_other)) return 'Type your stream.';
      return '';
    case 'field':
      if (!val(form.field)) return 'Select your broad area.';
      if (form.field === OTHER_OPTION && !val(form.field_other)) return 'Type your area of study.';
      return '';
    case 'college_name':
      return val(form.college_name) ? '' : 'Which college did you join?';
    case 'degree':
      if (!val(form.degree)) return 'Pick your degree.';
      if (form.degree === OTHER_OPTION && !val(form.degree_other)) return 'Type your degree.';
      return '';
    case 'admission_route':
      if (!val(form.admission_route)) return 'How did you get in?';
      if (form.admission_route === OTHER_OPTION && !val(form.admission_route_other)) return 'Type how you got in.';
      return '';
    case 'admission_rank': {
      const v = val(form.admission_rank);
      if (!v) return '';
      const rank = parseInt(v, 10);
      return Number.isNaN(rank) || rank <= 0 ? 'Rank must be a positive number.' : '';
    }
    case 'board_marks': {
      const v = val(form.board_marks);
      if (!v) return '';
      const marks = parseFloat(v);
      return Number.isNaN(marks) || marks < 0 || marks > 100 ? 'Marks must be between 0 and 100.' : '';
    }
    case 'current_status':
      if (!val(form.current_status)) return 'Select what you are doing now.';
      if (form.current_status === OTHER_OPTION && !val(form.current_status_other)) return 'Tell us what you are up to.';
      return '';
    case 'personal_email': {
      const v = val(form.personal_email);
      if (!v) return 'We need an email to reach you.';
      return EMAIL_RE.test(v) ? '' : 'That email does not look right.';
    }
    case 'phone_number': {
      const v = val(form.phone_number);
      if (!v) return 'We need a phone number to reach you.';
      return v.length < 7 ? 'That number looks too short.' : '';
    }
    case 'linkedin_url': {
      const v = val(form.linkedin_url);
      if (!v) return '';
      return URL_RE.test(v) ? '' : 'Start the link with https://';
    }
    default:
      return '';
  }
}

// Which fields belong to which step, so "Continue" checks exactly that step.
const STEP_FIELDS: FieldKey[][] = [
  ['username', 'password_val'],
  ['full_name', 'school_name', 'class_of', 'stream'],
  ['field', 'college_name', 'degree', 'admission_route', 'admission_rank', 'board_marks'],
  ['current_status', 'personal_email', 'phone_number', 'linkedin_url'],
  [],
];

/* ═══════════════════════════════════════════════════════════════════════════
   Page
═══════════════════════════════════════════════════════════════════════════ */
/**
 * Turn whatever the database or network threw into something a nervous
 * twenty-year-old can act on. The raw text still goes to the console for us.
 *
 * Without this, a unique-constraint violation surfaces verbatim as
 * `duplicate key value violates unique constraint "alumni_username_key"`,
 * which is both frightening and unactionable.
 */
// Versioned so a future field rename cannot resurrect an incompatible draft.
const DRAFT_KEY = 'veveaham.register.draft.v1';

function friendlySubmitError(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes('alumni_username_key') || t.includes('duplicate key') || t.includes('already registered')) {
    return 'That username has just been taken. Go back to step 1 and pick another — everything else you typed is still here.';
  }
  if (t.includes('failed to fetch') || t.includes('networkerror') || t.includes('load failed')) {
    return 'Could not reach the server. Check your connection and tap Submit again — nothing has been lost.';
  }
  if (t.includes('row-level security') || t.includes('permission denied')) {
    return 'The server would not accept that just now. Please try again in a moment, or tell the school office if it keeps happening.';
  }
  if (t.includes('payload') || t.includes('too large')) {
    return 'Your photo is too large to upload. Go back and pick a smaller one, or skip the photo — it is optional.';
  }
  return 'Something went wrong saving your profile. Please try again — and if it keeps happening, tell the school office.';
}

export default function RegisterPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [step, setStep] = useState(0);
  const [restored, setRestored] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  // C4 - username availability, checked on blur rather than at submit.
  const [usernameState, setUsernameState] = useState<'idle' | 'checking' | 'free' | 'taken'>('idle');
  const [tagOptions, setTagOptions] = useState<Record<string, string[]>>({});

  // A ref (not state) so a double-click can't slip through before React
  // re-renders the disabled button.
  const submitLockRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [showHigherStudies, setShowHigherStudies] = useState(false);
  const [higherStudies, setHigherStudies] = useState<HigherStudyEntry[]>([emptyHigherStudy()]);
  const [showWorkExperience, setShowWorkExperience] = useState(false);
  const [workExperience, setWorkExperience] = useState<WorkExperienceEntry[]>([emptyWorkExperience()]);

  useEffect(() => { void fetchApprovedOptions().then(setTagOptions); }, []);

  // Move focus to the new step's heading so the form is followable by keyboard
  // and screen reader, and the page doesn't stay scrolled halfway down.
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const streamOptions = useMemo(() => mergeOptions(STREAMS, tagOptions.stream), [tagOptions]);
  const degreeOptions = useMemo(() => mergeOptions(DEGREES, tagOptions.degree), [tagOptions]);
  const routeOptions = useMemo(() => mergeOptions(ADMISSION_ROUTES, tagOptions.admission_route), [tagOptions]);
  const statusOptions = useMemo(() => mergeOptions(STATUSES, tagOptions.current_status), [tagOptions]);
  const fieldOptions = useMemo(() => mergeOptions([...CATEGORIES.map((c) => c.label)], tagOptions.field), [tagOptions]);

  function update<K extends FieldKey>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  function markTouched(key: FieldKey) {
    setTouched((prev) => ({ ...prev, [key]: true }));
  }
  /** Error to display for a field: only once the person has left it. */
  function errorFor(key: FieldKey): string {
    return touched[key] ? validateField(key, form) : '';
  }
  function isValid(key: FieldKey): boolean {
    return !!touched[key] && !validateField(key, form) && String(form[key] ?? '').trim().length > 0;
  }

  const stepErrors = useMemo(
    () => STEP_FIELDS[step].map((k) => validateField(k, form)).filter(Boolean),
    [step, form],
  );
  const stepComplete = stepErrors.length === 0;

  // ── Draft persistence ──────────────────────────────────────────────────
  // Restore once on mount. Password and the File object are deliberately never
  // stored: one is a credential, the other cannot be serialised anyway.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { form?: Partial<FormState>; step?: number };
      if (!parsed.form) return;
      setForm((f) => ({ ...f, ...parsed.form, password_val: '', photo_file: null }));
      if (typeof parsed.step === 'number') setStep(Math.min(parsed.step, STEPS.length - 1));
      setRestored(true);
    } catch {
      // A corrupt draft should never block registration.
    }
  }, []);

  useEffect(() => {
    if (submitted) return;
    try {
      const { password_val: _pw, photo_file: _pf, ...safe } = form;
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ form: safe, step }));
    } catch {
      // Private browsing and full quotas both throw here; losing the draft is
      // not worth breaking the form over.
    }
  }, [form, step, submitted]);

  // Debounce-free: this only fires on blur, so at most one request per field
  // exit. Failures fall back to 'idle' rather than blocking - submit() still
  // does the authoritative check, this is purely to save a wasted five steps.
  async function checkUsername(candidate: string) {
    const v = candidate.trim();
    if (v.length < 3) { setUsernameState('idle'); return; }
    setUsernameState('checking');
    try {
      const { data, error: rpcErr } = await supabase.rpc('username_available', { candidate: v });
      if (rpcErr) { setUsernameState('idle'); return; }
      setUsernameState(data ? 'free' : 'taken');
    } catch {
      setUsernameState('idle');
    }
  }

  function goNext() {
    // Reveal every problem on this step at once rather than one at a time.
    const fields = STEP_FIELDS[step];
    setTouched((prev) => ({ ...prev, ...Object.fromEntries(fields.map((f) => [f, true])) }));
    const firstBadField = fields.find((k) => validateField(k, form));
    if (firstBadField) {
      // Take the person to the problem. goNext does not change `step`, so the
      // scroll-to-top effect never fires here - without this the error can sit
      // far above the fold and Continue looks like it simply did nothing.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(
          `.f-field--invalid input, .f-field--invalid select, [data-field="${firstBadField}"]`,
        );
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el?.focus?.({ preventScroll: true });
      });
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
    if (step < STEPS.length - 1) goNext();
    else void submit();
  }

  async function submit() {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setError('');

    if (!isSupabaseConfigured) {
      setError('The site is not connected to its database yet.');
      submitLockRef.current = false;
      return;
    }
    if (!form.consent_given) {
      setError('Please tick the consent box so we can show your profile.');
      submitLockRef.current = false;
      return;
    }
    // Re-check every step, in case someone skipped ahead.
    const allErrors = STEP_FIELDS.flat().map((k) => validateField(k, form)).filter(Boolean);
    if (allErrors.length) {
      setError(allErrors[0]);
      submitLockRef.current = false;
      return;
    }

    setSubmitting(true);
    try {
      const username = form.username.trim();

      // 1. Is the username free? Asked through an RPC because the browser can
      //    no longer read the alumni table directly (that is what leaked
      //    everyone's email and phone number).
      const { data: available, error: checkErr } = await supabase.rpc('username_available', { candidate: username });
      if (checkErr) throw checkErr;
      if (available === false) throw new Error('That username is already taken. Please choose another one.');

      // 2. Create the login. The email is synthesised from the username so the
      //    real address stays optional-to-verify and private.
      const authEmail = `${username}@${ALUMNI_LOGIN_DOMAIN}`;
      let userId: string;
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: authEmail,
        password: form.password_val,
        options: { data: { username, full_name: form.full_name.trim() } },
      });

      if (authErr) {
        // "Already registered" can mean this same person tried before and the
        // profile insert failed afterwards, leaving an account with no profile.
        // Signing in with the credentials they just typed proves it is theirs.
        const isDuplicate = /already registered|already exists/i.test(authErr.message);
        if (!isDuplicate) throw authErr;
        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
          email: authEmail, password: form.password_val,
        });
        if (signInErr || !signInData.user) {
          throw new Error('That username is already taken. Please choose another one.');
        }
        userId = signInData.user.id;
      } else {
        if (!authData.user) throw new Error('Could not create your account. Please try again.');
        userId = authData.user.id;
      }

      // 3. Photo (optional).
      let photoUrl: string | null = null;
      if (form.photo_file) {
        const file = form.photo_file;
        if (!file.type.startsWith('image/')) throw new Error('Please upload an image file (JPG, PNG, WEBP…).');
        if (file.size > 5 * 1024 * 1024) throw new Error('That photo is over 5MB — please pick a smaller one.');
        const ext = (file.name.match(/\.([a-zA-Z0-9]{1,5})$/)?.[1] ?? 'jpg').toLowerCase();
        const safeUsername = username.replace(/[^a-zA-Z0-9-_]/g, '_');
        const fileName = `${safeUsername}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('photos').upload(fileName, file, { contentType: file.type });
        if (upErr) throw upErr;
        photoUrl = supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;
      }

      // 4. Match college / organisation against the reference tables. An
      //    unmatched name is kept as typed and lands in the admin's queue.
      const typedCollege = cleanProperNoun(form.college_name);
      let collegeId: string | null = null;
      if (typedCollege) {
        const { data } = await supabase.from('colleges').select('id').ilike('name', typedCollege).maybeSingle();
        if (data) collegeId = data.id;
      }
      const typedOrg = cleanProperNoun(form.currently_at);
      let organizationId: string | null = null;
      if (typedOrg) {
        const { data } = await supabase.from('organizations').select('id').ilike('name', typedOrg).maybeSingle();
        if (data) organizationId = data.id;
      }

      const finalStream = resolveValue(form.stream, form.stream_other);
      const finalDegree = resolveValue(form.degree, form.degree_other);
      const finalField = resolveValue(form.field, form.field_other);
      const finalRoute = resolveValue(form.admission_route, form.admission_route_other);
      const finalStatus = resolveValue(form.current_status, form.current_status_other);
      const finalBoard = resolveValue(form.school_board, form.school_board_other);
      const usesBoardMarks = finalRoute === 'Board Marks';

      // 5. The profile row.
      const { data: inserted, error: insErr } = await supabase.from('alumni').insert({
        user_id: userId,
        username,
        full_name: form.full_name.trim(),
        school_name: form.school_name,
        school_board: finalBoard || null,
        class_of: parseInt(form.class_of, 10),
        stream: finalStream || null,
        show_photo: !!photoUrl,
        photo_url: photoUrl,
        personal_email: form.personal_email.trim(),
        phone_country_code: form.phone_country_code,
        phone_number: form.phone_number.trim(),
        linkedin_url: cleanFreeText(form.linkedin_url),
        college_id: collegeId,
        college_name_raw: typedCollege,
        degree: finalDegree || null,
        branch: cleanProperNoun(form.branch),
        field: finalField || null,
        admission_route: finalRoute || null,
        admission_rank: usesBoardMarks ? null : cleanFreeText(form.admission_rank),
        board_marks: usesBoardMarks ? cleanFreeText(form.board_marks) : null,
        board_cutoff: usesBoardMarks ? cleanFreeText(form.board_cutoff) : null,
        current_status: finalStatus,
        expected_finish_year: isInProgressStatus(finalStatus) && form.expected_finish_year
          ? parseInt(form.expected_finish_year, 10) : null,
        currently_at: typedOrg,
        organization_id: organizationId,
        designation: cleanProperNoun(form.designation),
        message_1: cleanFreeText(form.message_1),
        consent_given: true,
        approval_status: 'pending',
        modification_status: 'none',
      }).select('id').single();

      if (insErr) throw insErr;
      const newId = inserted?.id;

      // 6. Optional timelines.
      if (newId && showHigherStudies) {
        const rows = higherStudies.filter((s) => s.degree_name.trim()).map((s) => ({
          alumni_id: newId,
          degree_name: s.degree_name.trim(),
          institution: cleanProperNoun(s.institution),
          start_year: s.start_year ? parseInt(s.start_year, 10) : null,
          finish_year: s.finish_year ? parseInt(s.finish_year, 10) : null,
        }));
        if (rows.length) await supabase.from('higher_studies').insert(rows);
      }
      if (newId && showWorkExperience) {
        const rows = workExperience.filter((w) => w.company.trim()).map((w) => ({
          alumni_id: newId,
          company: cleanProperNoun(w.company)!,
          role: cleanProperNoun(w.role),
          start_year: w.start_year ? parseInt(w.start_year, 10) : null,
          end_year: w.is_current ? null : (w.end_year ? parseInt(w.end_year, 10) : null),
          is_current: w.is_current,
        }));
        if (rows.length) await supabase.from('work_experience').insert(rows);
      }

      // 7. Queue any free-typed values for staff review. They already show on
      //    this person's profile; this is only about joining the shared lists.
      if (form.stream === OTHER_OPTION) void proposeOption('stream', form.stream_other);
      if (form.degree === OTHER_OPTION) void proposeOption('degree', form.degree_other);
      if (form.admission_route === OTHER_OPTION) void proposeOption('admission_route', form.admission_route_other);
      if (form.current_status === OTHER_OPTION) void proposeOption('current_status', form.current_status_other);
      if (form.field === OTHER_OPTION) void proposeOption('field', form.field_other);

      // 8. Tell an admin. Never allowed to fail the registration.
      void fetch('/api/notify-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.full_name.trim(),
          classOf: form.class_of,
          school: form.school_name,
          college: typedCollege ?? '',
          currentStatus: finalStatus,
        }),
      }).catch(() => {});

      try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to lose */ }
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      // Supabase errors are plain objects with a `message`, not Error
      // instances, so an `instanceof Error` check alone silently hides them.
      const raw = err instanceof Error
        ? err.message
        : (err && typeof err === 'object' && 'message' in err)
          ? String((err as { message: unknown }).message)
          : '';
      setError(friendlySubmitError(raw));
      submitLockRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) return <SuccessScreen />;

  const isLast = step === STEPS.length - 1;
  const stepProps = { form, update, markTouched, errorFor, isValid };

  return (
    <main className="container container--narrow">
      <div className="card fade-up">
        <StepBar step={step} />

        <div className="step-head">
          <p className="step-label">Step {step + 1} of {STEPS.length}</p>
          <h2 className="step-title" ref={headingRef} tabIndex={-1}>{STEPS[step].title}</h2>
          <p className="step-sub">{STEPS[step].blurb}</p>
        </div>

        {error && <div className="alert alert--error" role="alert">{error}</div>}

        <form onSubmit={handleFormSubmit} noValidate>
          <div key={step} className="fade-up">
            {step === 0 && <StepAccount {...stepProps} usernameState={usernameState} checkUsername={checkUsername} />}
            {step === 1 && <StepSchool {...stepProps} streamOptions={streamOptions} />}
            {step === 2 && <StepStudies {...stepProps} fieldOptions={fieldOptions} degreeOptions={degreeOptions} routeOptions={routeOptions} />}
            {step === 3 && (
              <StepNow
                {...stepProps}
                statusOptions={statusOptions}
                showHigherStudies={showHigherStudies} setShowHigherStudies={setShowHigherStudies}
                higherStudies={higherStudies} setHigherStudies={setHigherStudies}
                showWorkExperience={showWorkExperience} setShowWorkExperience={setShowWorkExperience}
                workExperience={workExperience} setWorkExperience={setWorkExperience}
              />
            )}
            {step === 4 && <StepFinish {...stepProps} />}
          </div>

          <div className="wizard-nav">
            {step > 0 && (
              <button type="button" className="btn btn--ghost" onClick={goBack}>
                <span className="btn__inner">← Back</span>
              </button>
            )}
            <button type="submit" className="btn btn--neutral" disabled={submitting}>
              <span className="btn__inner">
                {submitting
                  ? <><span className="spinner spinner--neutral" /> Submitting…</>
                  : isLast ? 'Submit my profile ✨' : 'Continue →'}
              </span>
            </button>
          </div>

          {!isLast && !stepComplete && (
            <p className="step-remaining">
              {stepErrors.length} thing{stepErrors.length === 1 ? '' : 's'} left on this step
            </p>
          )}
        </form>
      </div>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Step props shared by all steps
───────────────────────────────────────────────────────────────────────── */
type StepProps = {
  form: FormState;
  update: <K extends FieldKey>(key: K, value: FormState[K]) => void;
  markTouched: (key: FieldKey) => void;
  errorFor: (key: FieldKey) => string;
  isValid: (key: FieldKey) => boolean;
};

function StepAccount({
  form, update, markTouched, errorFor, isValid, usernameState, checkUsername,
}: StepProps & {
  usernameState: 'idle' | 'checking' | 'free' | 'taken';
  checkUsername: (v: string) => void;
}) {
  return (
    <>
      <Field
        label="Choose a username" required autoFocus autoComplete="username"
        hint={
          usernameState === 'checking' ? 'checking if that one is free…'
          : usernameState === 'free' ? '✓ that one is free'
          : 'letters, numbers, - and _ only'
        }
        value={form.username}
        onChange={(v) => { update('username', v.toLowerCase().replace(/[^a-z0-9_-]/g, '')); }}
        onBlur={() => { markTouched('username'); checkUsername(form.username); }}
        error={usernameState === 'taken' ? 'That username is already taken — try another.' : errorFor('username')}
        valid={usernameState === 'free' && isValid('username')}
      />
      <Field
        label="Choose a password" required type="password" revealable autoComplete="new-password"
        hint="at least 6 characters"
        value={form.password_val}
        onChange={(v) => update('password_val', v)}
        onBlur={() => markTouched('password_val')}
        error={errorFor('password_val')} valid={isValid('password_val')}
      />
      <p className="form-note">
        You&apos;ll use these to sign in later and update your journey — there&apos;s no
        email verification step to wait for.
      </p>
    </>
  );
}

function StepSchool({ form, update, markTouched, errorFor, isValid, streamOptions }: StepProps & { streamOptions: string[] }) {
  return (
    <>
      <Field
        label="Full name" required autoFocus autoComplete="name"
        value={form.full_name}
        onChange={(v) => update('full_name', v)}
        onBlur={() => markTouched('full_name')}
        error={errorFor('full_name')} valid={isValid('full_name')}
      />

      <div className="field">
        <label className="field__label">Which school did you attend? <Req /></label>
        <Chips options={[...SCHOOLS]} value={form.school_name} onChange={(v) => { update('school_name', v); markTouched('school_name'); }} />
        {errorFor('school_name') && <p className="field__error">{errorFor('school_name')}</p>}
      </div>

      <Field
        label="Graduating year (Class of)" required type="number"
        min={1960} max={CURRENT_YEAR} inputMode="numeric"
        value={form.class_of}
        onChange={(v) => update('class_of', v.replace(/[^\d]/g, ''))}
        onBlur={() => markTouched('class_of')}
        error={errorFor('class_of')} valid={isValid('class_of')}
      />

      <SelectWithOther
        label="Stream at school" required options={streamOptions}
        value={form.stream} onChange={(v) => { update('stream', v); markTouched('stream'); }}
        otherValue={form.stream_other} onOtherChange={(v) => update('stream_other', v)}
        error={errorFor('stream')}
      />

      <SelectWithOther
        label="School board" options={SCHOOL_BOARDS} optional
        value={form.school_board} onChange={(v) => update('school_board', v)}
        otherValue={form.school_board_other} onOtherChange={(v) => update('school_board_other', v)}
        error=""
      />
    </>
  );
}

function StepStudies({
  form, update, markTouched, errorFor, isValid, fieldOptions, degreeOptions, routeOptions,
}: StepProps & { fieldOptions: string[]; degreeOptions: string[]; routeOptions: string[] }) {
  const route = resolveValue(form.admission_route, form.admission_route_other);
  const usesBoardMarks = form.admission_route === 'Board Marks';
  const skipsRank = ['Merit / Direct', 'Management Quota', 'Sports Quota', OTHER_OPTION, ''].includes(form.admission_route);

  return (
    <>
      <SelectWithOther
        label="Broad area of study" required options={fieldOptions}
        value={form.field} onChange={(v) => { update('field', v); markTouched('field'); }}
        otherValue={form.field_other} onOtherChange={(v) => update('field_other', v)}
        error={errorFor('field')}
      />

      <div onBlur={() => markTouched('college_name')}>
        <EntitySearchField
          table="colleges" label="College / University" required
          hint="start typing — we'll search every college in India"
          value={form.college_name}
          onChange={(v) => update('college_name', v)}
          searchShortNames
          invalid={!!errorFor('college_name')}
        />
      </div>
      {errorFor('college_name') && <p className="field__error">{errorFor('college_name')}</p>}

      <SelectWithOther
        label="Degree" required options={degreeOptions}
        value={form.degree} onChange={(v) => { update('degree', v); markTouched('degree'); }}
        otherValue={form.degree_other} onOtherChange={(v) => update('degree_other', v)}
        error={errorFor('degree')}
      />

      <Field
        label="Branch / Department" optional
        hint="e.g. Computer Science"
        value={form.branch} onChange={(v) => update('branch', v)}
        onBlur={() => markTouched('branch')} error="" valid={false}
      />

      <SelectWithOther
        label="How did you get in?" required options={routeOptions}
        value={form.admission_route} onChange={(v) => { update('admission_route', v); markTouched('admission_route'); }}
        otherValue={form.admission_route_other} onOtherChange={(v) => update('admission_route_other', v)}
        error={errorFor('admission_route')}
      />

      {usesBoardMarks ? (
        <div className="two-col">
          <Field
            label="Board marks (%)" optional type="number" min={0} max={100} step={0.01}
            value={form.board_marks} onChange={(v) => update('board_marks', v)}
            onBlur={() => markTouched('board_marks')}
            error={errorFor('board_marks')} valid={isValid('board_marks')}
          />
          <Field
            label="Cutoff" optional hint="if applicable"
            value={form.board_cutoff} onChange={(v) => update('board_cutoff', v)}
            onBlur={() => markTouched('board_cutoff')} error="" valid={false}
          />
        </div>
      ) : !skipsRank && route ? (
        <Field
          label={`${route} rank`} optional type="number" min={1} inputMode="numeric"
          hint="shown only as a range, never the exact number"
          value={form.admission_rank}
          onChange={(v) => update('admission_rank', v.replace(/[^\d]/g, ''))}
          onBlur={() => markTouched('admission_rank')}
          error={errorFor('admission_rank')} valid={isValid('admission_rank')}
        />
      ) : null}

      {(route === 'Board Marks' || (!skipsRank && route)) && (
        <p className="form-note form-note--warm">
          Honestly? An average rank helps a junior more than a top one does.
          Most of them aren&apos;t aiming for rank 100 — they want to know if
          someone like them got in. We only ever show a range, like
          &ldquo;Rank 10,000–25,000&rdquo;.
        </p>
      )}
    </>
  );
}

function StepNow({
  form, update, markTouched, errorFor, isValid, statusOptions,
  showHigherStudies, setShowHigherStudies, higherStudies, setHigherStudies,
  showWorkExperience, setShowWorkExperience, workExperience, setWorkExperience,
}: StepProps & {
  statusOptions: string[];
  showHigherStudies: boolean; setShowHigherStudies: (v: boolean) => void;
  higherStudies: HigherStudyEntry[]; setHigherStudies: React.Dispatch<React.SetStateAction<HigherStudyEntry[]>>;
  showWorkExperience: boolean; setShowWorkExperience: (v: boolean) => void;
  workExperience: WorkExperienceEntry[]; setWorkExperience: React.Dispatch<React.SetStateAction<WorkExperienceEntry[]>>;
}) {
  const status = resolveValue(form.current_status, form.current_status_other);

  return (
    <>
      <SelectWithOther
        label="What are you up to now?" required options={statusOptions}
        value={form.current_status} onChange={(v) => { update('current_status', v); markTouched('current_status'); }}
        otherValue={form.current_status_other} onOtherChange={(v) => update('current_status_other', v)}
        error={errorFor('current_status')}
      />

      {isInProgressStatus(status) && (
        <Field
          label="Expected to finish in" optional type="number" hint="year"
          min={CURRENT_YEAR - 10} max={CURRENT_YEAR + 10}
          value={form.expected_finish_year}
          onChange={(v) => update('expected_finish_year', v.replace(/[^\d]/g, ''))}
          onBlur={() => markTouched('expected_finish_year')} error="" valid={false}
        />
      )}

      <div className="two-col">
        <EntitySearchField
          table="organizations" label="Currently at"
          hint="company or institute, optional"
          value={form.currently_at}
          onChange={(v) => update('currently_at', v)}
        />
        <Field
          label="Role / Designation" optional
          value={form.designation} onChange={(v) => update('designation', v)}
          onBlur={() => markTouched('designation')} error="" valid={false}
        />
      </div>

      <OptionalSection
        title="Higher studies" caption="PG, PhD, diploma — add as many as you like"
        open={showHigherStudies} onToggle={setShowHigherStudies}
      >
        {higherStudies.map((entry, i) => (
          <div key={i} className="entry-card">
            <Field label="Degree" hint="e.g. MS, MBA, PhD" value={entry.degree_name}
              onChange={(v) => setHigherStudies((p) => p.map((x, j) => j === i ? { ...x, degree_name: v } : x))}
              onBlur={() => {}} error="" valid={false} />
            <Field label="Institution" optional value={entry.institution}
              onChange={(v) => setHigherStudies((p) => p.map((x, j) => j === i ? { ...x, institution: v } : x))}
              onBlur={() => {}} error="" valid={false} />
            <div className="two-col">
              <Field label="Start year" optional type="number" value={entry.start_year}
                onChange={(v) => setHigherStudies((p) => p.map((x, j) => j === i ? { ...x, start_year: v } : x))}
                onBlur={() => {}} error="" valid={false} />
              <Field label="Finish year" optional type="number" value={entry.finish_year}
                onChange={(v) => setHigherStudies((p) => p.map((x, j) => j === i ? { ...x, finish_year: v } : x))}
                onBlur={() => {}} error="" valid={false} />
            </div>
            {higherStudies.length > 1 && (
              <button type="button" onClick={() => setHigherStudies((p) => p.filter((_, j) => j !== i))} className="btn btn--ghost" style={{ marginTop: 10 }}>
                <span className="btn__inner">Remove</span>
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setHigherStudies((p) => [...p, emptyHigherStudy()])} className="btn btn--ghost btn--block">
          <span className="btn__inner">+ Add another degree</span>
        </button>
      </OptionalSection>

      <OptionalSection
        title="Work experience" caption="like a LinkedIn timeline"
        open={showWorkExperience} onToggle={setShowWorkExperience}
      >
        {workExperience.map((entry, i) => (
          <div key={i} className="entry-card">
            <Field label="Company / Organisation" value={entry.company}
              onChange={(v) => setWorkExperience((p) => p.map((x, j) => j === i ? { ...x, company: v } : x))}
              onBlur={() => {}} error="" valid={false} />
            <Field label="Role" optional value={entry.role}
              onChange={(v) => setWorkExperience((p) => p.map((x, j) => j === i ? { ...x, role: v } : x))}
              onBlur={() => {}} error="" valid={false} />
            <div className="two-col">
              <Field label="Start year" optional type="number" value={entry.start_year}
                onChange={(v) => setWorkExperience((p) => p.map((x, j) => j === i ? { ...x, start_year: v } : x))}
                onBlur={() => {}} error="" valid={false} />
              {!entry.is_current && (
                <Field label="End year" optional type="number" value={entry.end_year}
                  onChange={(v) => setWorkExperience((p) => p.map((x, j) => j === i ? { ...x, end_year: v } : x))}
                  onBlur={() => {}} error="" valid={false} />
              )}
            </div>
            <label className="cbox-row" style={{ marginTop: 10 }}>
              <span className="cbox">
                <input type="checkbox" checked={entry.is_current}
                  onChange={(e) => setWorkExperience((p) => p.map((x, j) => j === i ? { ...x, is_current: e.target.checked, end_year: '' } : x))} />
                <span className="cbox__mark" />
              </span>
              <span>I currently work here</span>
            </label>
            {workExperience.length > 1 && (
              <button type="button" onClick={() => setWorkExperience((p) => p.filter((_, j) => j !== i))} className="btn btn--ghost" style={{ marginTop: 10 }}>
                <span className="btn__inner">Remove</span>
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setWorkExperience((p) => [...p, emptyWorkExperience()])} className="btn btn--ghost btn--block">
          <span className="btn__inner">+ Add another job</span>
        </button>
      </OptionalSection>

      <div className="contact-block">
        <h3 className="contact-block__title">How the school can reach you</h3>
        <p className="contact-block__note">
          🔒 Your email and phone number are for the school office only. They are never
          shown on the public directory.
        </p>

        <Field
          label="Email" required type="email" autoComplete="email"
          value={form.personal_email} onChange={(v) => update('personal_email', v)}
          onBlur={() => markTouched('personal_email')}
          error={errorFor('personal_email')} valid={isValid('personal_email')}
        />
        <div className="two-col">
          <SelectField
            label="Country code" value={form.phone_country_code}
            onChange={(v) => update('phone_country_code', v)} options={COUNTRY_CODES}
          />
          <Field
            label="Phone number" required type="tel" inputMode="tel" autoComplete="tel-national"
            value={form.phone_number}
            onChange={(v) => update('phone_number', v.replace(/\D/g, ''))}
            onBlur={() => markTouched('phone_number')}
            error={errorFor('phone_number')} valid={isValid('phone_number')}
          />
        </div>
        <Field
          label="LinkedIn" optional type="url" autoComplete="url" hint="shown publicly if you add it"
          value={form.linkedin_url} onChange={(v) => update('linkedin_url', v)}
          onBlur={() => markTouched('linkedin_url')}
          error={errorFor('linkedin_url')} valid={isValid('linkedin_url')}
        />
      </div>
    </>
  );
}

function StepFinish({ form, update }: StepProps) {
  // Local: only meaningful while this step is on screen, and it should reset
  // if the person leaves and comes back with a different file in mind.
  const [photoError, setPhotoError] = useState('');
  return (
    <>
      <div className="field" style={{ marginBottom: 24 }}>
        <label className="field__label">Photo <Optional /></label>
        <label className="upload">
          <span className="upload__blob" />
          <span className="upload__inner">
            <span className="upload__icon">📷</span>
            <span className="upload__text">
              <span className="upload__title">{form.photo_file ? 'Change photo' : 'Choose a photo'}</span>
              <span className="upload__hint">JPG, PNG or WEBP · up to 5MB</span>
            </span>
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              // Checked here rather than at submit: finding out your photo is
              // too big only after you have pressed the final button is the
              // worst possible moment to be told.
              if (file && !file.type.startsWith('image/')) {
                setPhotoError('That file is not an image — pick a JPG, PNG or WEBP.');
                update('photo_file', null);
                return;
              }
              if (file && file.size > 5 * 1024 * 1024) {
                const mb = (file.size / (1024 * 1024)).toFixed(1);
                setPhotoError(`That photo is ${mb}MB and the limit is 5MB. Most phones can shrink it when sharing, or just skip the photo — it is optional.`);
                update('photo_file', null);
                return;
              }
              setPhotoError('');
              update('photo_file', file);
            }}
          />
        </label>
        {photoError && <p className="field__error" style={{ position: 'static', marginTop: 8 }}>{photoError}</p>}
        {form.photo_file && <div className="upload__filename">✓ {form.photo_file.name}</div>}
      </div>

      <div className="field">
        <label className="field__label">One thing you&apos;d tell your junior self? <Optional /></label>
        <textarea
          value={form.message_1}
          onChange={(e) => update('message_1', e.target.value)}
          placeholder="e.g. don't stress over one bad exam, or start applying early…"
        />
        <p className="hint" style={{ display: 'block', marginTop: 6 }}>
          This is the part juniors read most.
        </p>
      </div>

      <div className="consent" style={{ marginTop: 20 }}>
        <label className="cbox">
          <input type="checkbox" id="consent" checked={form.consent_given} onChange={(e) => update('consent_given', e.target.checked)} />
          <span className="cbox__mark" />
        </label>
        <label htmlFor="consent">
          I agree that my name and the details I chose to share can be shown publicly on
          the Veveaham alumni site. My email and phone number will never be shown publicly.
        </label>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Form primitives
───────────────────────────────────────────────────────────────────────── */
function Req() { return <span className="req" aria-hidden> *</span>; }
function Optional() { return <span className="opt">optional</span>; }

function Field({
  label, hint, value, onChange, onBlur, error, valid,
  type = 'text', required, optional, autoFocus, min, max, step, inputMode, revealable,
  autoComplete,
}: {
  label: string; hint?: string; value: string;
  onChange: (v: string) => void; onBlur: () => void;
  error: string; valid: boolean;
  type?: string; required?: boolean; optional?: boolean; autoFocus?: boolean;
  min?: number; max?: number; step?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  revealable?: boolean;
  autoComplete?: string;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const active = focused || value.trim().length > 0;
  const effectiveType = revealable && revealed ? 'text' : type;

  return (
    <div className={`f-field${active ? ' f-field--active' : ''}${error ? ' f-field--invalid' : ''}${valid ? ' f-field--valid' : ''}`}>
      <input
        id={id} type={effectiveType} value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); onBlur(); }}
        placeholder="" autoFocus={autoFocus}
        min={min} max={max} step={step} inputMode={inputMode}
        autoComplete={autoComplete}
        aria-required={required} aria-invalid={!!error}
        style={revealable ? { paddingRight: 44 } : undefined}
      />
      <label htmlFor={id}>
        {label}{required && <Req />}{optional && <Optional />}
      </label>

      {revealable && (
        <button
          type="button" className="reveal-btn"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? 'Hide password' : 'Show password'}
        >
          {revealed ? '🙈' : '👁️'}
        </button>
      )}
      {/* A green tick is a small thing, but it tells someone filling in a long
          form that a step is genuinely done rather than merely typed in. */}
      {valid && !error && <span className="field__tick" aria-hidden>✓</span>}
      {error ? <p className="field__error">{error}</p> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
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

function SelectWithOther({
  label, options, value, onChange, otherValue, onOtherChange, error, required, optional,
}: {
  label: string; options: string[]; value: string; onChange: (v: string) => void;
  otherValue: string; onOtherChange: (v: string) => void; error: string;
  required?: boolean; optional?: boolean;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="field">
      <div className={`f-field f-field--active${error ? ' f-field--invalid' : ''}`}>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-required={required} aria-invalid={!!error}>
          <option value="" disabled hidden>Select…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <label htmlFor={id}>{label}{required && <Req />}{optional && <Optional />}</label>
      </div>

      {value === OTHER_OPTION && (
        <>
          <div className="f-field f-field--active" style={{ marginTop: 10 }}>
            <input
              type="text" value={otherValue}
              onChange={(e) => onOtherChange(e.target.value)}
              placeholder=""
              aria-label={`Specify ${label.toLowerCase()}`}
            />
            <label>Please specify</label>
          </div>
          <p className="hint" style={{ display: 'block', marginTop: 4 }}>
            We&apos;ll show this on your profile. Staff check new entries before adding
            them to the list everyone picks from.
          </p>
        </>
      )}

      {error && <p className="field__error">{error}</p>}
    </div>
  );
}

function Chips({ options, value, onChange }: {
  options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={o} className={`chip${value === o ? ' chip--active' : ''}`} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** A collapsed block that stays visibly optional until opened. */
function OptionalSection({
  title, caption, open, onToggle, children,
}: {
  title: string; caption: string; open: boolean;
  onToggle: (v: boolean) => void; children: React.ReactNode;
}) {
  return (
    <div className="opt-section">
      <button type="button" className="opt-section__head" onClick={() => onToggle(!open)} aria-expanded={open}>
        <span>
          <span className="opt-section__title">{title}</span>
          <span className="opt-section__caption">{caption}</span>
        </span>
        <span className="opt-section__toggle">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="opt-section__body">{children}</div>}
    </div>
  );
}

function StepBar({ step }: { step: number }) {
  return (
    <div className="steps" aria-hidden>
      {STEPS.map((s, i) => (
        <div key={s.title} className={`step${i < step ? ' step--done' : ''}${i === step ? ' step--active' : ''}`}>
          <div className="step__dot">{i < step ? '✓' : i + 1}</div>
          {i < STEPS.length - 1 && (
            <div className="step__bar" style={{ '--fill': i < step ? '100%' : '0%' } as React.CSSProperties} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Success
───────────────────────────────────────────────────────────────────────── */
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
      // Clipboard API needs HTTPS and permission; the link is visible anyway.
    }
  }

  return (
    <main className="container container--narrow">
      <div className="card fade-up" style={{ textAlign: 'center' }}>
        <div className="success-icon"><span>✓</span></div>
        <h1 className="success-title">Registration successful</h1>
        <p className="success-subtitle">Welcome to the Veveaham Alumni Network.</p>
        <p className="subtitle">
          Your profile has been submitted and is waiting for admin approval.
          <br />
          You can sign in any time with your username and password.
        </p>

        <hr style={{ border: 'none', borderBottom: '1px solid var(--border)', margin: '28px 0 20px' }} />

        <h3 style={{ marginBottom: 4 }}>Help grow the network</h3>
        <p className="hint" style={{ marginBottom: 14 }}>
          Invite your classmates — the more journeys juniors can see, the better.
        </p>

        <div className="share-row">
          <div className="share-link">🔗 Your alumni invite link</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={copyLink} className="btn btn--ghost">
              <span className="btn__inner">{copied ? '✓ Copied' : 'Copy link'}</span>
            </button>
            <a className="icon-share-btn" href={whatsapp} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" title="Share on WhatsApp">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0012.04 2zm0 1.67c2.24 0 4.35.87 5.93 2.45a8.24 8.24 0 012.42 5.85c0 4.55-3.7 8.25-8.35 8.25a8.3 8.3 0 01-4.24-1.16l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 01-1.27-4.4c0-4.55 3.7-8.25 8.3-8.28zm-4.6 4.7c-.17 0-.45.06-.68.32-.23.26-.9.88-.9 2.14 0 1.26.92 2.48 1.05 2.65.13.17 1.8 2.86 4.42 3.9 2.18.87 2.62.7 3.1.65.47-.04 1.5-.61 1.72-1.2.21-.59.21-1.1.15-1.2-.06-.11-.24-.17-.5-.3-.26-.13-1.5-.74-1.74-.82-.23-.09-.4-.13-.57.13-.17.26-.65.82-.8 1-.15.17-.29.19-.55.06-.26-.13-1.09-.4-2.07-1.28-.77-.68-1.28-1.53-1.43-1.79-.15-.26-.02-.4.11-.53.12-.12.26-.31.39-.47.13-.15.17-.26.26-.43.09-.17.04-.33-.02-.46-.06-.13-.57-1.4-.79-1.9-.2-.5-.42-.43-.57-.44l-.48-.01z" /></svg>
            </a>
            <a className="icon-share-btn" href={email} aria-label="Share via email" title="Share via email">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></svg>
            </a>
          </div>
        </div>

        <div className="success-next">
          <h3>What happens next?</h3>
          <div className="next-item"><span>1.</span> An administrator reviews your profile.</div>
          <div className="next-item"><span>2.</span> Once approved, you appear in the alumni directory.</div>
          <div className="next-item"><span>3.</span> Sign in any time to keep your journey up to date.</div>
        </div>

        <div className="success-login">
          <a className="success-login-btn" href="/login">Continue to login →</a>
        </div>
      </div>
    </main>
  );
}
