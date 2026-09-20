'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import EntitySearchField from '../../lib/EntitySearchField';
import { linkFor, toPick, type InstitutePick } from '../../lib/institutes';
import SchoolPicker from '../../lib/SchoolPicker';
import { cleanFreeText, cleanProperNoun } from '../../lib/text';
import { canonicalOption, fetchApprovedOptions, fetchOptionAliases, proposeOption } from '../../lib/publicData';
import {
  STREAMS, DEGREES, ADMISSION_ROUTES, NOW_CHOICES, asksForRank, boardForSchool, publicRouteLabel,
  COUNTRY_CODES, OTHER_OPTION, isInProgressStatus, mergeOptions, resolveValue,
  statusForCourse, statusForNowChoice, PROFESSIONAL_COURSES, PROFESSIONAL_STAGES,
} from '../../lib/options';
import { phoneProblem } from '../../lib/contactKeys';
import { CATEGORIES } from '../../lib/types';

/* ─────────────────────────────────────────────────────────────────────────
   Form model
───────────────────────────────────────────────────────────────────────── */
interface FormState {
  password_val: string;
  full_name: string;
  school_name: string;
  class_of: string;
  stream: string;
  stream_other: string;
  field: string;
  field_other: string;
  joined_college: 'yes' | 'no' | 'not_yet';
  college_name: string;
  // The suggestion picked for each institute field, kept (and saved in the
  // draft) so submit links that exact row instead of re-matching the text.
  college_pick: InstitutePick;
  org_pick: InstitutePick;
  degree: string;
  degree_other: string;
  professional_course: string;
  professional_course_other: string;
  professional_org: string;
  professional_stage: string;
  branch: string;
  admission_route: string;
  admission_route_other: string;
  admission_rank: string;
  board_marks: string;
  board_cutoff: string;
  /* "Are you still doing this?" - yes means the course above is current, and
     current_status is derived from it rather than asked as a dropdown. */
  still_studying: string;
  now_choice: string;
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
  password_val: '',
  full_name: '', school_name: '',
  class_of: '', stream: '', stream_other: '',
  field: '', field_other: '', joined_college: 'yes', college_name: '', college_pick: null, org_pick: null, degree: '', degree_other: '', branch: '',
  professional_course: '', professional_course_other: '', professional_stage: '', professional_org: '',
  admission_route: '', admission_route_other: '', admission_rank: '', board_marks: '', board_cutoff: '',
  still_studying: '', now_choice: '', current_status: '', current_status_other: '', expected_finish_year: '',
  currently_at: '', designation: '',
  personal_email: '', phone_country_code: '+91', phone_number: '', linkedin_url: '',
  message_1: '', photo_file: null, consent_given: false,
};

const CURRENT_YEAR = new Date().getFullYear();
// Accounts sign in through an opaque internal address on this domain; people
// type their real email or phone, and the login_handle RPC maps it across.
const ALUMNI_LOGIN_DOMAIN = 'veveaham-alumni-network.com';
const MIN_PASSWORD = 8;

const STEPS = [
  { title: 'You', blurb: "Your name, and the email or phone you'll sign in with." },
  { title: 'School', blurb: 'Your Veveaham years.' },
  { title: 'After 12th', blurb: "Where you went, how you got in, and what you're doing now." },
  { title: 'Finish', blurb: "A photo, a word for your juniors, and you're done." },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/i;

/* ─────────────────────────────────────────────────────────────────────────
   Validation — one rule set, used both per-field (on blur) and per-step.
───────────────────────────────────────────────────────────────────────── */
type FieldKey = keyof FormState;

/** Smooth scrolling, unless the visitor has asked for less movement. */
function scrollBehavior(): ScrollBehavior {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto' : 'smooth';
}

/** The first control on this step that still has nothing in it. */
function firstEmptyControl(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  const controls = root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="file"]), select, textarea',
  );
  for (const c of Array.from(controls)) {
    if (c.disabled || c.offsetParent === null) continue;
    if (!c.value.trim()) return c;
  }
  return null;
}

/**
 * Bring a block that has just appeared into view.
 *
 * Answering "yes, I joined a college" adds four more questions below the fold,
 * and the form used to leave you to find them. This moves the page the moment
 * they appear, which is the scrolling people were doing by hand.
 */
function useAppear(shown: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const was = useRef(shown);
  useEffect(() => {
    if (shown && !was.current) {
      ref.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
    }
    was.current = shown;
  }, [shown]);
  return ref;
}

/** Did they just describe a course — a degree, or a CA/CS/CMA qualification? */
function describesCourse(form: FormState): boolean {
  return form.joined_college === 'yes' || !!form.professional_course.trim();
}

/** What they are doing now, as one of the values STATUSES already knows. */
function statusFromForm(form: FormState): string {
  if (describesCourse(form) && form.still_studying === 'yes') {
    return statusForCourse(form.joined_college === 'yes', form.professional_course);
  }
  return resolveValue(statusForNowChoice(form.now_choice), form.current_status_other);
}

function validateField(key: FieldKey, form: FormState): string {
  const val = (v: unknown) => String(v ?? '').trim();
  switch (key) {
    case 'password_val':
      return form.password_val.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : '';
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
      // Only required of people who actually joined a college. A CA student
      // has no college to name, and the old required field forced them to
      // invent one.
      if (form.joined_college !== 'yes') return '';
      return val(form.college_name) ? '' : 'Which college did you join?';
    case 'degree':
      if (form.joined_college !== 'yes') return '';
      if (!val(form.degree)) return 'Pick your degree.';
      if (form.degree === OTHER_OPTION && !val(form.degree_other)) return 'Type your degree.';
      return '';
    case 'professional_course':
      // Optional throughout; only the "Other" free-text needs a value.
      if (form.professional_course === OTHER_OPTION && !val(form.professional_course_other)) {
        return 'Type which qualification.';
      }
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
    case 'still_studying':
      // Only asked of someone who named a course a moment ago.
      if (!describesCourse(form)) return '';
      return val(form.still_studying) ? '' : 'Are you still doing this?';
    case 'now_choice': {
      // Only asked once "are you still doing this?" has been answered No - or
      // when there was no course to ask about in the first place.
      if (describesCourse(form) && form.still_studying !== 'no') return '';
      if (!val(form.now_choice)) return 'What are you doing now?';
      if (form.now_choice === 'other' && !val(form.current_status_other)) return 'Tell us what you are up to.';
      return '';
    }
    case 'personal_email': {
      const v = val(form.personal_email);
      if (!v) return 'We need an email to reach you.';
      return EMAIL_RE.test(v) ? '' : 'That email does not look right.';
    }
    case 'phone_number':
      return phoneProblem(form.phone_country_code, form.phone_number);
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
  ['full_name', 'personal_email', 'phone_number', 'password_val'],
  ['school_name', 'class_of', 'stream'],
  ['field', 'college_name', 'degree', 'professional_course', 'admission_route', 'admission_rank', 'board_marks', 'still_studying', 'now_choice'],
  ['linkedin_url'],
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
// v2: usernames removed and the steps reordered, so a v1 draft would land on
// the wrong step.
const DRAFT_KEY = 'veveaham.register.draft.v2';

function friendlySubmitError(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes('alumni_email_key_unique') || t.includes('already-registered-email')) {
    return 'That email is already registered. Sign in instead, or reset your password if you have forgotten it.';
  }
  if (t.includes('alumni_phone_key_unique') || t.includes('already-registered-phone')) {
    return 'That phone number is already registered. Sign in instead, or reset your password if you have forgotten it.';
  }
  if (t.includes('duplicate key')) {
    return 'That email or phone number is already registered. Sign in instead, or reset your password.';
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
  // Email and phone are now how people sign in, so they must be unique.
  // Checked on blur so nobody fills in four steps before finding out.
  const [contactState, setContactState] = useState<{ email: ContactCheck; phone: ContactCheck }>({ email: 'idle', phone: 'idle' });
  // Whether the typed address could receive mail at all - see /api/validate/email.
  const [emailDomain, setEmailDomain] = useState<{ state: 'idle' | 'bad'; message: string; suggestion: string | null }>(
    { state: 'idle', message: '', suggestion: null },
  );
  const [tagOptions, setTagOptions] = useState<Record<string, string[]>>({});

  // A ref (not state) so a double-click can't slip through before React
  // re-renders the disabled button.
  const submitLockRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepBodyRef = useRef<HTMLDivElement>(null);

  const [showHigherStudies, setShowHigherStudies] = useState(false);
  const [higherStudies, setHigherStudies] = useState<HigherStudyEntry[]>([emptyHigherStudy()]);
  const [showWorkExperience, setShowWorkExperience] = useState(false);
  const [workExperience, setWorkExperience] = useState<WorkExperienceEntry[]>([emptyWorkExperience()]);

  useEffect(() => { void fetchApprovedOptions().then(setTagOptions); }, []);
  // Spellings the school has already merged away, so typing an old one under
  // "Other" lands on the name everyone else's profile uses.
  const [optionAliases, setOptionAliases] = useState<Record<string, Record<string, string>>>({});
  useEffect(() => { void fetchOptionAliases().then(setOptionAliases); }, []);

  // Move focus to the new step's heading so the form is followable by keyboard
  // and screen reader, and the page doesn't stay scrolled halfway down. Then,
  // on a pointer device, put the cursor in the first empty field so typing can
  // start immediately - not on touch, where it would throw the keyboard up over
  // the step the moment it opens.
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
    if (!window.matchMedia('(pointer: fine)').matches) return undefined;
    const settle = setTimeout(() => {
      firstEmptyControl(stepBodyRef.current)?.focus({ preventScroll: true });
    }, scrollBehavior() === 'auto' ? 0 : 340);
    return () => clearTimeout(settle);
  }, [step]);

  const streamOptions = useMemo(() => mergeOptions(STREAMS, tagOptions.stream, optionAliases.stream), [tagOptions, optionAliases]);
  const degreeOptions = useMemo(() => mergeOptions(DEGREES, tagOptions.degree, optionAliases.degree), [tagOptions, optionAliases]);
  const professionalOptions = useMemo(() => mergeOptions(PROFESSIONAL_COURSES, tagOptions.professional_course, optionAliases.professional_course), [tagOptions, optionAliases]);
  const routeOptions = useMemo(() => mergeOptions(ADMISSION_ROUTES, tagOptions.admission_route, optionAliases.admission_route), [tagOptions, optionAliases]);
  const fieldOptions = useMemo(() => mergeOptions([...CATEGORIES.map((c) => c.label)], tagOptions.field, optionAliases.field), [tagOptions, optionAliases]);

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
      const parsed = JSON.parse(saved) as {
        form?: Partial<FormState>; step?: number;
        higherStudies?: HigherStudyEntry[]; workExperience?: WorkExperienceEntry[];
      };
      if (!parsed.form) return;
      setForm((f) => ({ ...f, ...parsed.form, password_val: '', photo_file: null }));
      // Past courses and jobs are held outside `form`, and used to be dropped
      // from the draft entirely - someone who typed three jobs and came back
      // the next day found them gone.
      if (parsed.higherStudies?.length) {
        setHigherStudies(parsed.higherStudies);
        if (parsed.higherStudies.some((r) => r.degree_name.trim())) setShowHigherStudies(true);
      }
      if (parsed.workExperience?.length) {
        setWorkExperience(parsed.workExperience);
        if (parsed.workExperience.some((r) => r.company.trim())) setShowWorkExperience(true);
      }
      // The password is never saved, and step 1 is where it is asked, so a
      // restored draft starts there with everything else still filled in.
      setStep(0);
      setRestored(true);
    } catch {
      // A corrupt draft should never block registration.
    }
  }, []);

  useEffect(() => {
    if (submitted) return;
    try {
      const { password_val: _pw, photo_file: _pf, ...safe } = form;
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ form: safe, step, higherStudies, workExperience }));
    } catch {
      // Private browsing and full quotas both throw here; losing the draft is
      // not worth breaking the form over.
    }
  }, [form, step, higherStudies, workExperience, submitted]);

  /**
   * Can this address actually receive the welcome mail and a reset link?
   *
   * Only a definite no - a domain that does not exist, or accepts no mail -
   * stops the step. Anything ambiguous passes: being unable to register
   * because DNS was slow would be far worse than a typo slipping through.
   */
  async function checkEmailDomain() {
    const email = form.personal_email.trim();
    if (!EMAIL_RE.test(email)) { setEmailDomain({ state: 'idle', message: '', suggestion: null }); return; }
    try {
      const res = await fetch('/api/validate/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json()) as { ok?: boolean; reason?: string; suggestion?: string | null };
      const domain = email.slice(email.lastIndexOf('@') + 1);
      if (body.ok) {
        setEmailDomain({ state: 'idle', message: '', suggestion: body.suggestion ?? null });
        return;
      }
      setEmailDomain({
        state: 'bad',
        message: body.reason === 'no-domain'
          ? `We can't find “${domain}” — is there a typo?`
          : `“${domain}” doesn't seem to accept email.`,
        suggestion: body.suggestion ?? null,
      });
    } catch {
      setEmailDomain({ state: 'idle', message: '', suggestion: null });
    }
  }

  // Fires on blur only. A failed check falls back to 'idle' rather than
  // blocking: submit() checks again, and the database enforces uniqueness.
  async function checkContact(which: 'email' | 'phone') {
    const email = which === 'email' ? form.personal_email.trim() : '';
    const phone = which === 'phone' ? form.phone_number.trim() : '';
    if ((which === 'email' && !EMAIL_RE.test(email)) || (which === 'phone' && phone.replace(/\D/g, '').length < 7)) {
      setContactState((c) => ({ ...c, [which]: 'idle' }));
      return;
    }
    setContactState((c) => ({ ...c, [which]: 'checking' }));
    try {
      const { data, error: rpcErr } = await supabase.rpc('contact_available', {
        p_email: email || null, p_phone_code: form.phone_country_code, p_phone: phone || null,
      });
      if (rpcErr || !data) { setContactState((c) => ({ ...c, [which]: 'idle' })); return; }
      const free = which === 'email' ? data.email_free : data.phone_free;
      setContactState((c) => ({ ...c, [which]: free ? 'free' : 'taken' }));
    } catch {
      setContactState((c) => ({ ...c, [which]: 'idle' }));
    }
  }

  function goNext() {
    // Reveal every problem on this step at once rather than one at a time.
    const fields = STEP_FIELDS[step];
    setTouched((prev) => ({ ...prev, ...Object.fromEntries(fields.map((f) => [f, true])) }));
    const taken = step === 0
      && (contactState.email === 'taken' || contactState.phone === 'taken' || emailDomain.state === 'bad');
    const firstBadField = fields.find((k) => validateField(k, form))
      ?? (taken
        ? (contactState.email === 'taken' || emailDomain.state === 'bad' ? 'personal_email' : 'phone_number')
        : undefined);
    if (firstBadField) {
      // Take the person to the problem. goNext does not change `step`, so the
      // scroll-to-top effect never fires here - without this the error can sit
      // far above the fold and Continue looks like it simply did nothing.
      // Named field first: the old selector took whichever invalid field came
      // first in the document, which is often not the one being complained about.
      requestAnimationFrame(() => {
        const holder = document.querySelector<HTMLElement>(`[data-field="${firstBadField}"]`);
        const el = holder?.querySelector<HTMLElement>('input, select, textarea, button') ?? holder;
        el?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
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
      // 1. Email and phone are sign-in identifiers now, so they must be free.
      const { data: contacts, error: checkErr } = await supabase.rpc('contact_available', {
        p_email: form.personal_email.trim(), p_phone_code: form.phone_country_code, p_phone: form.phone_number.trim(),
      });
      if (checkErr) throw checkErr;
      if (contacts && contacts.email_free === false) throw new Error('already-registered-email');
      if (contacts && contacts.phone_free === false) throw new Error('already-registered-phone');

      // 2. Create the login under an opaque internal address. People never see
      //    or type it: they sign in with their email or phone, which
      //    login_handle maps to this address.
      const handle = `${crypto.randomUUID()}@${ALUMNI_LOGIN_DOMAIN}`;
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: handle,
        password: form.password_val,
        options: { data: { full_name: form.full_name.trim() } },
      });
      if (authErr) throw authErr;
      if (!authData.user) throw new Error('Could not create your account. Please try again.');
      const userId = authData.user.id;
      if (!authData.session) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email: handle, password: form.password_val });
        if (signInErr) throw signInErr;
      }

      // 3. Photo (optional).
      let photoUrl: string | null = null;
      if (form.photo_file) {
        const file = form.photo_file;
        if (!file.type.startsWith('image/')) throw new Error('Please upload an image file (JPG, PNG, WEBP…).');
        if (file.size > 5 * 1024 * 1024) throw new Error('That photo is over 5MB — please pick a smaller one.');
        const ext = (file.name.match(/\.([a-zA-Z0-9]{1,5})$/)?.[1] ?? 'jpg').toLowerCase();
        const fileName = `${userId}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('photos').upload(fileName, file, { contentType: file.type });
        if (upErr) throw upErr;
        photoUrl = supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;
      }

      // 4. Link the college and organisation: the picked suggestion when there
      //    is one, else an unambiguous exact name or alias. Anything else is
      //    kept as typed and lands in the admin's unmatched queue.
      const typedCollege = form.joined_college === 'yes' ? cleanProperNoun(form.college_name) : null;
      const collegeId = await linkFor('college', typedCollege, form.college_pick);
      const typedOrg = cleanProperNoun(form.currently_at);
      const organizationId = await linkFor('organization', typedOrg, form.org_pick);

      const canon = (category: string, value: string) => canonicalOption(optionAliases, category, value);
      const finalStream = canon('stream', resolveValue(form.stream, form.stream_other));
      const finalDegree = canon('degree', resolveValue(form.degree, form.degree_other));
      const finalField = canon('field', resolveValue(form.field, form.field_other));
      const finalRoute = canon('admission_route', resolveValue(form.admission_route, form.admission_route_other));
      const finalStatus = canon('current_status', statusFromForm(form));


      // 5. The profile row.
      const { data: inserted, error: insErr } = await supabase.from('alumni').insert({
        user_id: userId,
        full_name: form.full_name.trim(),
        school_name: form.school_name,
        // Decided by the school, not asked for: see boardForSchool.
        school_board: boardForSchool(form.school_name),
        class_of: parseInt(form.class_of, 10),
        stream: finalStream || null,
        show_photo: !!photoUrl,
        photo_url: photoUrl,
        personal_email: form.personal_email.trim().toLowerCase(),
        phone_country_code: form.phone_country_code,
        phone_number: form.phone_number.trim(),
        linkedin_url: cleanFreeText(form.linkedin_url),
        college_id: collegeId,
        college_name_raw: typedCollege,
        professional_course: canon('professional_course', resolveValue(form.professional_course, form.professional_course_other)) || null,
        professional_stage: form.professional_course ? (form.professional_stage || null) : null,
        professional_org: form.professional_course ? (cleanProperNoun(form.professional_org) || null) : null,
        degree: finalDegree || null,
        branch: cleanProperNoun(form.branch),
        field: finalField || null,
        admission_route: finalRoute || null,
        // All three are kept, whatever the route says today. Nulling the
        // unused half meant that changing your route from an exam to Board
        // Marks silently deleted the rank you had already typed. What is
        // *shown* is decided by asksForRank at the card, not here.
        admission_rank: cleanFreeText(form.admission_rank),
        board_marks: cleanFreeText(form.board_marks),
        board_cutoff: cleanFreeText(form.board_cutoff),
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

      if (insErr) {
        // The login exists but the profile did not save; sign out so a retry
        // starts clean instead of half-signed-in.
        await supabase.auth.signOut().catch(() => undefined);
        throw insErr;
      }
      const newId = inserted?.id;

      // 6. Optional timelines. The profile is already saved, so a failure here
      //    must not fail the registration - but it must not vanish either.
      const lostSections: string[] = [];
      if (newId) {
        const rows = higherStudies.filter((s) => s.degree_name.trim()).map((s) => ({
          alumni_id: newId,
          degree_name: s.degree_name.trim(),
          institution: cleanProperNoun(s.institution),
          start_year: s.start_year ? parseInt(s.start_year, 10) : null,
          finish_year: s.finish_year ? parseInt(s.finish_year, 10) : null,
        }));
        if (rows.length) {
          const { error: hsErr } = await supabase.from('higher_studies').insert(rows);
          if (hsErr) { console.error('higher_studies insert', hsErr); lostSections.push('higher studies'); }
        }
      }
      if (newId) {
        const rows = workExperience.filter((w) => w.company.trim()).map((w) => ({
          alumni_id: newId,
          company: cleanProperNoun(w.company)!,
          role: cleanProperNoun(w.role),
          start_year: w.start_year ? parseInt(w.start_year, 10) : null,
          end_year: w.is_current ? null : (w.end_year ? parseInt(w.end_year, 10) : null),
          is_current: w.is_current,
        }));
        if (rows.length) {
          const { error: weErr } = await supabase.from('work_experience').insert(rows);
          if (weErr) { console.error('work_experience insert', weErr); lostSections.push('work experience'); }
        }
      }

      // 7. Queue any free-typed values for staff review. They already show on
      //    this person's profile; this is only about joining the shared lists.
      if (form.stream === OTHER_OPTION) void proposeOption('stream', form.stream_other);
      if (form.degree === OTHER_OPTION) void proposeOption('degree', form.degree_other);
      if (form.admission_route === OTHER_OPTION) void proposeOption('admission_route', form.admission_route_other);
      if (form.now_choice === 'other') void proposeOption('current_status', form.current_status_other);
      if (form.field === OTHER_OPTION) void proposeOption('field', form.field_other);
      if (form.professional_course === OTHER_OPTION) void proposeOption('professional_course', form.professional_course_other);

      // 8. Alert the school and welcome the new alumnus. The route reads the
      //    details from the database using this session, so it can only ever
      //    email this person. Never allowed to fail the registration.
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        await fetch('/api/notify/registered', {
          method: 'POST',
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
          keepalive: true,
        }).catch(() => undefined);
        // And prove the address reaches them, so a future password reset
        // actually arrives. Fire-and-forget: nothing here can fail a
        // registration that has already been saved.
        void fetch('/api/auth/send-verification', {
          method: 'POST',
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
          keepalive: true,
        }).catch(() => undefined);
      }

      try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to lose */ }
      setSubmitted(true);
      // Straight to their profile: they are already signed in.
      const params = new URLSearchParams({ welcome: '1' });
      if (lostSections.length) params.set('unsaved', lostSections.join(','));
      window.location.assign(`/profile?${params.toString()}`);
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

  if (submitted) {
    return (
      <main className="container container--narrow">
        <div className="card" style={{ textAlign: 'center' }}>
          <span className="spinner spinner--neutral" /> <p className="subtitle">Opening your profile…</p>
        </div>
      </main>
    );
  }

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

        {restored && step === 0 && !error && (
          <div className="alert alert--success" role="status">
            Welcome back — your answers are still here. Enter a password again to continue.
          </div>
        )}
        {error && <div className="alert alert--error" role="alert">{error}</div>}

        <form onSubmit={handleFormSubmit} noValidate>
          <div key={step} className="fade-up" ref={stepBodyRef}>
            {step === 0 && (
              <StepYou
                {...stepProps}
                contactState={contactState}
                emailDomain={emailDomain}
                checkEmailDomain={checkEmailDomain}
                useSuggestion={(fixed) => {
                  update('personal_email', fixed);
                  setEmailDomain({ state: 'idle', message: '', suggestion: null });
                }}
                checkContact={checkContact}
                resetContact={(which) => setContactState((c) => (c[which] === 'idle' ? c : { ...c, [which]: 'idle' }))}
              />
            )}
            {step === 1 && <StepSchool {...stepProps} streamOptions={streamOptions} />}
            {step === 2 && (
              <>
                <StepStudies {...stepProps} fieldOptions={fieldOptions} degreeOptions={degreeOptions} routeOptions={routeOptions} professionalOptions={professionalOptions} />
                <h3 className="step-subhead">What you&apos;re doing now</h3>
                <StepNow
                  {...stepProps}
                  showHigherStudies={showHigherStudies} setShowHigherStudies={setShowHigherStudies}
                  higherStudies={higherStudies} setHigherStudies={setHigherStudies}
                  showWorkExperience={showWorkExperience} setShowWorkExperience={setShowWorkExperience}
                  workExperience={workExperience} setWorkExperience={setWorkExperience}
                />
              </>
            )}
            {step === 3 && <StepFinish {...stepProps} />}
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

type ContactCheck = 'idle' | 'checking' | 'free' | 'taken';

function StepYou({
  form, update, markTouched, errorFor, isValid, contactState, checkContact, resetContact,
  emailDomain, checkEmailDomain, useSuggestion,
}: StepProps & {
  contactState: { email: ContactCheck; phone: ContactCheck };
  emailDomain: { state: 'idle' | 'bad'; message: string; suggestion: string | null };
  checkEmailDomain: () => void;
  useSuggestion: (fixedEmail: string) => void;
  checkContact: (which: 'email' | 'phone') => void;
  // Editing after a check makes the old answer stale; it is re-checked on blur.
  resetContact: (which: 'email' | 'phone') => void;
}) {
  const takenNote = (what: string) => (
    <>That {what} is already registered — <a href="/login">sign in</a> or <a href="/forgot-password">reset your password</a>.</>
  );
  return (
    <>
      <Field
        name="full_name" label="Full name" required autoFocus autoComplete="name"
        value={form.full_name}
        onChange={(v) => update('full_name', v)}
        onBlur={() => markTouched('full_name')}
        error={errorFor('full_name')} valid={isValid('full_name')}
      />

      <div data-field="personal_email">
        <Field
          name="personal_email" label="Email" required type="email" autoComplete="email" inputMode="email"
          hint={contactState.email === 'checking' ? 'checking…' : 'you can sign in with this'}
          value={form.personal_email}
          onChange={(v) => { update('personal_email', v); resetContact('email'); }}
          onBlur={() => { markTouched('personal_email'); checkContact('email'); checkEmailDomain(); }}
          error={errorFor('personal_email')}
          valid={isValid('personal_email') && contactState.email !== 'taken' && emailDomain.state !== 'bad'}
        />
        {contactState.email === 'taken' && <p className="field__error field__error--static">{takenNote('email')}</p>}
        {emailDomain.state === 'bad' && (
          <p className="field__error field__error--static">{emailDomain.message}</p>
        )}
        {emailDomain.suggestion && (
          <p className="hint" style={{ display: 'block', margin: '6px 0 0' }}>
            Did you mean{' '}
            <button
              type="button" className="link-btn"
              onClick={() => useSuggestion(
                `${form.personal_email.trim().slice(0, form.personal_email.trim().lastIndexOf('@') + 1)}${emailDomain.suggestion}`,
              )}
            >
              {form.personal_email.trim().split('@')[0]}@{emailDomain.suggestion}
            </button>?
          </p>
        )}
      </div>

      <div className="two-col two-col--code" data-field="phone_number">
        <SelectField
          label="Code" value={form.phone_country_code}
          onChange={(v) => update('phone_country_code', v)} options={COUNTRY_CODES}
        />
        <Field
          name="phone_number" label="Phone number" required type="tel" inputMode="tel" autoComplete="tel-national"
          hint={contactState.phone === 'checking' ? 'checking…' : 'or sign in with this'}
          value={form.phone_number}
          onChange={(v) => { update('phone_number', v.replace(/[^\d\s]/g, '')); resetContact('phone'); }}
          onBlur={() => { markTouched('phone_number'); checkContact('phone'); }}
          error={errorFor('phone_number')}
          valid={isValid('phone_number') && contactState.phone !== 'taken'}
        />
      </div>
      {contactState.phone === 'taken' && <p className="field__error field__error--static">{takenNote('phone number')}</p>}

      <Field
        name="password_val" label="Choose a password" required type="password" revealable autoComplete="new-password"
        hint={`at least ${MIN_PASSWORD} characters`}
        value={form.password_val}
        onChange={(v) => update('password_val', v)}
        onBlur={() => markTouched('password_val')}
        error={errorFor('password_val')} valid={isValid('password_val')}
      />

      <p className="form-note">
        🔒 Your email and phone number are only for signing in and for the school
        office. They are never shown on the public directory.
      </p>
    </>
  );

}

function StepSchool({ form, update, markTouched, errorFor, isValid, streamOptions }: StepProps & { streamOptions: string[] }) {
  return (
    <>
      <div className="field">
        <label className="field__label" id="school-label">Which school did you attend? <Req /></label>
        <SchoolPicker
          labelledBy="school-label"
          value={form.school_name}
          onChange={(v) => { update('school_name', v); markTouched('school_name'); }}
          invalid={!!errorFor('school_name')}
        />
        {errorFor('school_name') && <p className="field__error">{errorFor('school_name')}</p>}
      </div>

      <Field
        name="class_of" label="Graduating year (Class of)" required type="number"
        min={1960} max={CURRENT_YEAR} inputMode="numeric"
        value={form.class_of}
        onChange={(v) => update('class_of', v.replace(/[^\d]/g, ''))}
        onBlur={() => markTouched('class_of')}
        error={errorFor('class_of')} valid={isValid('class_of')}
      />

      <SelectWithOther
        name="stream" label="Stream at school" required options={streamOptions}
        value={form.stream} onChange={(v) => { update('stream', v); markTouched('stream'); }}
        otherValue={form.stream_other} onOtherChange={(v) => update('stream_other', v)}
        error={errorFor('stream')}
      />
    </>
  );
}

function StepStudies({
  form, update, markTouched, errorFor, isValid, fieldOptions, degreeOptions, routeOptions, professionalOptions,
}: StepProps & { fieldOptions: string[]; degreeOptions: string[]; routeOptions: string[]; professionalOptions: string[] }) {
  const route = resolveValue(form.admission_route, form.admission_route_other);
  const usesBoardMarks = form.admission_route === 'Board Marks';
  const wantsRank = asksForRank(form.admission_route);
  const collegeRef = useAppear(form.joined_college === 'yes');

  return (
    <>
      <SelectWithOther
        name="field" label="Broad area of study" required options={fieldOptions}
        value={form.field} onChange={(v) => { update('field', v); markTouched('field'); }}
        otherValue={form.field_other} onOtherChange={(v) => update('field_other', v)}
        error={errorFor('field')}
      />

      {/* Asked before the college fields, because the honest answer for a CA
          student is "no" - and the old form had no way to say that, forcing
          them to invent a college name to get past validation. */}
      <div className="field" data-field="joined_college">
        <label>After 12th, did you join a college?</label>
        <Chips
          options={['Yes', 'Not yet', 'No']}
          value={form.joined_college === 'yes' ? 'Yes' : form.joined_college === 'not_yet' ? 'Not yet' : 'No'}
          onChange={(v) => update('joined_college', v === 'Yes' ? 'yes' : v === 'Not yet' ? 'not_yet' : 'no')}
        />
      </div>

      <div ref={collegeRef}>
      {form.joined_college === 'yes' && (
        <>
          <div onBlur={() => markTouched('college_name')}>
            <EntitySearchField
              kind="college" label="College / University" required
              hint="short names work too — “IIT Madras”, “CEG”, “NIT Trichy”"
              value={form.college_name}
              onChange={(v) => update('college_name', v)}
              onSelect={(hit) => update('college_pick', toPick(hit))}
              invalid={!!errorFor('college_name')}
            />
          </div>
          {errorFor('college_name') && <p className="field__error">{errorFor('college_name')}</p>}

          <SelectWithOther
            name="degree" label="Degree" required options={degreeOptions}
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
        </>
      )}

      </div>

      <SelectWithOther
        name="admission_route" label="How did you get in?" required options={routeOptions}
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
      ) : wantsRank && route ? (
        <Field
          label={`${route} rank`} optional type="number" min={1} inputMode="numeric"
          hint="shown only as a range, never the exact number"
          value={form.admission_rank}
          onChange={(v) => update('admission_rank', v.replace(/[^\d]/g, ''))}
          onBlur={() => markTouched('admission_rank')}
          error={errorFor('admission_rank')} valid={isValid('admission_rank')}
        />
      ) : null}

      {(route === 'Board Marks' || (wantsRank && route)) && (
        <p className="form-note form-note--warm">
          Honestly? An average rank helps a junior more than a top one does.
          Most of them aren&apos;t aiming for rank 100 — they want to know if
          someone like them got in. We only ever show a range, like
          &ldquo;Rank 10,000–25,000&rdquo;.
        </p>
      )}

      {/* Always shown, whichever way the college question was answered: plenty
          of people read for CA alongside a degree, and plenty do it instead of
          one. Presenting it as an either/or would misrepresent both. It sits
          after "how did you get in" so the college questions run together
          rather than being interrupted by a qualification most people skip. */}
      <div className="opt-section opt-section--static">
        <div className="opt-section__body">
          <p className="opt-section__title">Doing CA, CS, CMA or ACCA? <span className="opt">optional</span></p>
          <p className="opt-section__caption" style={{ marginBottom: 12 }}>
            Many people do this alongside a degree, and many do it on its own — either way it belongs here.
          </p>
        <SelectWithOther
          name="professional_course" label="Qualification" optional options={professionalOptions}
          value={form.professional_course}
          onChange={(v) => { update('professional_course', v); markTouched('professional_course'); }}
          otherValue={form.professional_course_other}
          onOtherChange={(v) => update('professional_course_other', v)}
          error={errorFor('professional_course')}
        />
        {form.professional_course && (
          <SelectField
            label="How far along?" value={form.professional_stage}
            onChange={(v) => update('professional_stage', v)}
            options={PROFESSIONAL_STAGES}
            placeholder="Select stage"
          />
        )}
        {form.professional_course && (
          <Field
            label="Articling / studying at" optional
            hint="the firm or institute, if you'd like to name it"
            value={form.professional_org} onChange={(v) => update('professional_org', v)}
            onBlur={() => markTouched('professional_org')} error="" valid={false}
          />
        )}
        </div>
      </div>
    </>
  );
}

/**
 * What they are doing now.
 *
 * This used to be an eleven-item dropdown standing on its own, and people were
 * guessing at it: a class-of-2026 student picked "Higher Studies" for the UG
 * degree they are still in the middle of. Since they have just described a
 * course, the honest first question is whether they are still on it - one tap,
 * and the school knows it has a current student. Only if they are not do we ask
 * what they moved to, and then in the shape LinkedIn uses: what, where, which
 * role.
 */
function StepNow({
  form, update, markTouched, errorFor, isValid,
  showHigherStudies, setShowHigherStudies, higherStudies, setHigherStudies,
  showWorkExperience, setShowWorkExperience, workExperience, setWorkExperience,
}: StepProps & {
  showHigherStudies: boolean; setShowHigherStudies: (v: boolean) => void;
  higherStudies: HigherStudyEntry[]; setHigherStudies: React.Dispatch<React.SetStateAction<HigherStudyEntry[]>>;
  showWorkExperience: boolean; setShowWorkExperience: (v: boolean) => void;
  workExperience: WorkExperienceEntry[]; setWorkExperience: React.Dispatch<React.SetStateAction<WorkExperienceEntry[]>>;
}) {
  const asksStill = describesCourse(form);
  const stillStudying = asksStill && form.still_studying === 'yes';
  // One question at a time: "what are you doing now?" only makes sense once
  // they have said they are no longer on the course above.
  const asksNow = !asksStill || form.still_studying === 'no';
  const course = [resolveValue(form.degree, form.degree_other), form.professional_course]
    .filter(Boolean).join(' / ');
  const choice = NOW_CHOICES.find((c) => c.key === form.now_choice);
  const nowRef = useAppear(asksNow && !!form.now_choice && form.now_choice !== 'break');

  return (
    <>
      {asksStill && (
        <div className="field" data-field="still_studying">
          <label>Are you still doing {course || 'this'}? <span className="req" aria-hidden> *</span></label>
          <Chips
            options={['Yes', 'No']}
            value={form.still_studying === 'yes' ? 'Yes' : form.still_studying === 'no' ? 'No' : ''}
            onChange={(v) => { update('still_studying', v === 'Yes' ? 'yes' : 'no'); markTouched('still_studying'); }}
          />
          <p className="hint" style={{ display: 'block', margin: '6px 0 0' }}>
            Yes tells the school you are a current student, and juniors see it that way too.
          </p>
          {errorFor('still_studying') && (
            <p className="field__error" style={{ position: 'static', marginTop: 6 }}>{errorFor('still_studying')}</p>
          )}
        </div>
      )}

      {asksNow && (
        <div className="field" data-field="now_choice">
          <label>What are you doing now? <span className="req" aria-hidden> *</span></label>
          <Chips
            options={NOW_CHOICES.map((c) => c.label)}
            value={choice?.label ?? ''}
            onChange={(v) => {
              update('now_choice', NOW_CHOICES.find((c) => c.label === v)?.key ?? '');
              markTouched('now_choice');
            }}
          />
          {errorFor('now_choice') && (
            <p className="field__error" style={{ position: 'static', marginTop: 6 }}>{errorFor('now_choice')}</p>
          )}
          {form.now_choice === 'other' && (
            <div style={{ marginTop: 12 }}>
              <Field
                label="Tell us in a few words" value={form.current_status_other}
                onChange={(v) => update('current_status_other', v)}
                onBlur={() => markTouched('now_choice')} error="" valid={false}
              />
            </div>
          )}
        </div>
      )}

      {isInProgressStatus(statusFromForm(form)) && (
        <Field
          label="Expected to finish in" optional type="number" hint="year"
          min={CURRENT_YEAR - 10} max={CURRENT_YEAR + 10}
          value={form.expected_finish_year}
          onChange={(v) => update('expected_finish_year', v.replace(/[^\d]/g, ''))}
          onBlur={() => markTouched('expected_finish_year')} error="" valid={false}
        />
      )}

      {asksNow && !!form.now_choice && form.now_choice !== 'break' && (
        <div className="two-col" ref={nowRef}>
          <EntitySearchField
            kind="organization"
            label={form.now_choice === 'working' ? 'Where do you work?' : 'Where?'}
            hint="company or institute, optional"
            value={form.currently_at}
            onChange={(v) => update('currently_at', v)}
            onSelect={(hit) => update('org_pick', toPick(hit))}
          />
          <Field
            label={form.now_choice === 'working' ? 'Your role' : 'Role / Title'} optional
            value={form.designation} onChange={(v) => update('designation', v)}
            onBlur={() => markTouched('designation')} error="" valid={false}
          />
        </div>
      )}

      <p className="form-note">
        Been somewhere before this? Add it below if you like — or leave it, and add it
        from your profile whenever you have a minute.
      </p>

      <OptionalSection
        title="Courses before this" caption="PG, PhD, diploma — optional, you can add these later"
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
        title="Jobs before this" caption="company, role, years — optional"
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

    </>
  );
}

function StepFinish({ form, update, markTouched, errorFor, isValid }: StepProps) {
  // Local: only meaningful while this step is on screen, and it should reset
  // if the person leaves and comes back with a different file in mind.
  const [photoError, setPhotoError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!form.photo_file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(form.photo_file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [form.photo_file]);

  const route = publicRouteLabel(resolveValue(form.admission_route, form.admission_route_other));
  const college = form.joined_college === 'yes' ? cleanProperNoun(form.college_name) : null;
  const initials = form.full_name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <>
      {/* Photos are what the home page shows, so show people exactly how theirs
          will look before they decide whether to add one. */}
      <div className="photo-preview">
        <p className="photo-preview__label">How you&apos;ll appear on the home page</p>
        <div className="photo-preview__card">
          <div className="photo-preview__avatar">
            {previewUrl ? <img src={previewUrl} alt="" /> : <span>{initials}</span>}
          </div>
          <div>
            <div className="photo-preview__name">{form.full_name.trim() || 'Your name'}</div>
            <div className="photo-preview__meta">
              {[college, route ? `via ${route}` : null, form.class_of ? `Class of ${form.class_of}` : null].filter(Boolean).join(' · ') || 'Veveaham alumnus'}
            </div>
          </div>
        </div>
        {!previewUrl && (
          <p className="photo-preview__nudge">
            Profiles with a photo are the ones juniors stop and read. It stays optional.
          </p>
        )}
      </div>

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

      <Field
        name="linkedin_url" label="LinkedIn" optional type="url" autoComplete="url" hint="shown publicly if you add it"
        value={form.linkedin_url} onChange={(v) => update('linkedin_url', v)}
        onBlur={() => markTouched('linkedin_url')}
        error={errorFor('linkedin_url')} valid={isValid('linkedin_url')}
      />

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
  name, label, hint, value, onChange, onBlur, error, valid,
  type = 'text', required, optional, autoFocus, min, max, step, inputMode, revealable,
  autoComplete,
}: {
  /** The FormState key, so "fix this field" can scroll to exactly this one. */
  name?: FieldKey;
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
    <div
      className={`f-field${active ? ' f-field--active' : ''}${error ? ' f-field--invalid' : ''}${valid ? ' f-field--valid' : ''}`}
      data-field={name}
    >
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

function SelectField({ name, label, value, onChange, options, placeholder }: {
  name?: FieldKey;
  label: string; value: string; onChange: (v: string) => void; options: string[];
  placeholder?: string;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="f-field f-field--active" data-field={name}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

function SelectWithOther({
  name, label, options, value, onChange, otherValue, onOtherChange, error, required, optional,
}: {
  /** The FormState key, so "fix this field" can scroll to exactly this one. */
  name?: FieldKey;
  label: string; options: string[]; value: string; onChange: (v: string) => void;
  otherValue: string; onOtherChange: (v: string) => void; error: string;
  required?: boolean; optional?: boolean;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="field" data-field={name}>
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
