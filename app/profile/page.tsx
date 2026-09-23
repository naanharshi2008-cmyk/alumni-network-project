'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import { phoneProblem } from '../../lib/contactKeys';
import EntitySearchField from '../../lib/EntitySearchField';
import { linkFor, toPick, type InstitutePick } from '../../lib/institutes';
import SchoolPicker from '../../lib/SchoolPicker';
import { cleanFreeText, cleanProperNoun , formatFullDate } from '../../lib/text';
import {
  canonicalOption, fetchApprovedOptions, fetchOptionAliases, fetchOrganizationNames, proposeOption,
} from '../../lib/publicData';
import {
  STREAMS, DEGREES, STATUSES, NOW_CHOICES, boardForSchool,
  COUNTRY_CODES, OTHER_OPTION, LEGACY_STREAM_MAP, officialSchoolName,
  PROFESSIONAL_COURSES, PROFESSIONAL_STAGES,
  isInProgressStatus, mergeOptions, splitStoredValue, resolveValue,
} from '../../lib/options';
import { CATEGORIES, categoryForDegree } from '../../lib/types';
import OptionSearchField from '../../lib/OptionSearchField';
import AdmissionFields from '../../lib/forms/AdmissionFields';
import ExamAttemptsField from '../../lib/forms/ExamAttemptsField';
import AdmitsField from '../../lib/forms/AdmitsField';
import { OptionalBlock } from '../../lib/forms/controls';
import GapYearField from '../../lib/forms/GapYearField';
import FamilyHomeFields from '../../lib/forms/FamilyHomeFields';
import LinkedInField from '../../lib/forms/LinkedInField';
import {
  admissionColumns, admissionFromRow, admissionProblem, admitRows, admitsFromRows, allOffers, attemptRows, attemptsFromRows, pathDraftsFromRows,
  contextualBranchAliases, emptyAdmission, emptyFamily, emptyGap, familyFromRow, familyProblems, gapFromRows,
  gapProblem, gapRows, inGapYear, joinedCollege, privateRow, seatYear,
  type AdmissionDraft, type AdmitDraft, type AttemptDraft, type FamilyDraft, type FamilyKey, type GapDraft,
} from '../../lib/forms/model';
import { branchVocab, canonicalBranch, examVocab } from '../../lib/forms/vocab';
import { handleFromStored, parseLinkedIn } from '../../lib/linkedin';
import { examAreas } from '../../lib/exams';
import ShareCard from '../../lib/ShareCard';

interface AlumnusData {
  id: string;
  /* The address of their public page. Loaded with the row all along and
     thrown away by the normaliser, so the one person who most wanted to see
     that page had no link to it. */
  public_slug: string;
  full_name: string;
  school_name: string;
  admission_number: string;
  class_of: string;
  stream: string;
  personal_email: string;
  phone_country_code: string;
  phone_number: string;
  linkedin_url: string;
  college_name: string;
  college_id: string | null;
  degree: string;
  professional_course: string;
  professional_stage: string;
  professional_org: string;
  branch: string;
  field: string;
  admission_route: string;
  admission_rank: string;
  board_marks: string;
  board_cutoff: string;
  current_status: string;
  expected_finish_year: string;
  currently_at: string;
  organization_id: string | null;
  designation: string;
  message_1: string;
  message_2: string;
  photo_url: string | null;
  approval_status: string;
  modification_status: string;
  /* What the school said. rejection_reason has existed since migration 07 and
     has never been shown to the one person it was written for; review_note
     arrives with migration 15, for an edit held back rather than a
     registration turned down. */
  rejection_reason: string;
  review_note: string;
  last_updated: string | null;
  last_confirmed_at: string | null;
  email_verified_at: string | null;
  seeded_by_school: boolean;
  college_thoughts: string;
}

interface HigherStudyEntry {
  id?: string;
  degree_name: string; institution: string; start_year: string; finish_year: string;
  /** The college it resolved to, when there is one (migration 21). */
  pick?: InstitutePick;
}
interface WorkExperienceEntry {
  id?: string;
  company: string; role: string; start_year: string; end_year: string; is_current: boolean;
}

const emptyHigherStudy = (): HigherStudyEntry => ({ degree_name: '', institution: '', start_year: '', finish_year: '' });
const emptyWorkExperience = (): WorkExperienceEntry => ({ company: '', role: '', start_year: '', end_year: '', is_current: false });

const CURRENT_YEAR = new Date().getFullYear();

/* The answers worth a tap, and the escape hatch to the full list. The chips
   are NOW_CHOICES minus its own "Something else", which is spelled out here
   so the two lists cannot drift apart. */
const SOMETHING_ELSE = 'Something else';
const NOW_CHIPS = NOW_CHOICES.filter((c) => c.key !== 'other');

/**
 * The DB allows most of these to be null, but every .trim() here assumes a
 * string. Loading a raw row straight into state used to crash the save with
 * "Cannot read properties of null (reading 'trim')", so normalise on the way in.
 */
function normalizeProfile(raw: any): AlumnusData {
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    ...raw,
    public_slug: str(raw.public_slug),
    full_name: str(raw.full_name),
    school_name: officialSchoolName(raw.school_name),
    admission_number: str(raw.admission_number),
    class_of: raw.class_of ? String(raw.class_of) : '',
    stream: str(raw.stream),
    personal_email: str(raw.personal_email),
    phone_country_code: str(raw.phone_country_code) || '+91',
    phone_number: str(raw.phone_number),
    linkedin_url: str(raw.linkedin_url),
    college_name: raw.colleges?.name || str(raw.college_name_raw),
    college_id: raw.college_id ?? null,
    degree: str(raw.degree),
    professional_course: str(raw.professional_course),
    professional_stage: str(raw.professional_stage),
    professional_org: str(raw.professional_org),
    branch: str(raw.branch),
    field: str(raw.field),
    admission_route: str(raw.admission_route),
    admission_rank: raw.admission_rank ? String(raw.admission_rank) : '',
    board_marks: raw.board_marks ? String(raw.board_marks) : '',
    board_cutoff: str(raw.board_cutoff),
    current_status: str(raw.current_status),
    expected_finish_year: raw.expected_finish_year ? String(raw.expected_finish_year) : '',
    currently_at: str(raw.currently_at),
    organization_id: raw.organization_id ?? null,
    designation: str(raw.designation),
    message_1: str(raw.message_1),
    message_2: str(raw.message_2),
    photo_url: raw.photo_url ?? null,
    approval_status: str(raw.approval_status),
    modification_status: str(raw.modification_status),
    rejection_reason: str(raw.rejection_reason),
    review_note: str(raw.review_note),
    last_updated: raw.last_updated ?? null,
    last_confirmed_at: raw.last_confirmed_at ?? null,
    email_verified_at: raw.email_verified_at ?? null,
    // False only on a row the school entered before the person ever signed in.
    seeded_by_school: raw.consent_given === false,
    college_thoughts: str(raw.college_thoughts),
  };
}

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Someone the school entered never saw the registration form, so they have
  // never agreed to appear. They say so here, once - and it saves the moment
  // they tick it, published profile or not (migration 18 made consent a live
  // switch), so it can never again be the thing standing between them and a
  // save.
  const [seedConsent, setSeedConsent] = useState(false);
  const [consentState, setConsentState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  async function giveConsent(checked: boolean) {
    setSeedConsent(checked);
    if (!checked || !profile) return;
    setConsentState('saving');
    const { error: consentErr } = await supabase.from('alumni').update({ consent_given: true }).eq('id', profile.id);
    if (consentErr) { setSeedConsent(false); setConsentState('failed'); return; }
    setConsentState('saved');
  }
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [notice, setNotice] = useState<{ welcome: boolean; unsaved: string[]; passwordUpdated: boolean }>({
    welcome: false, unsaved: [], passwordUpdated: false,
  });

  // Read once, then drop them from the address bar so a refresh or a shared
  // link doesn't show "Welcome" again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const welcome = params.get('welcome') === '1';
    const unsaved = (params.get('unsaved') ?? '').split(',').filter(Boolean);
    const passwordUpdated = params.get('password') === 'updated';
    if (welcome || unsaved.length || passwordUpdated) {
      setNotice({ welcome, unsaved, passwordUpdated });
      window.history.replaceState(null, '', '/profile');
    }
  }, []);

  const [profile, setProfile] = useState<AlumnusData | null>(null);
  // The institute each field is linked to. Seeded from the saved links, so an
  // untouched field keeps its id instead of being re-matched by name on save.
  const [picks, setPicks] = useState<{ college: InstitutePick; org: InstitutePick }>({ college: null, org: null });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [higherStudies, setHigherStudies] = useState<HigherStudyEntry[]>([]);
  const [workExperience, setWorkExperience] = useState<WorkExperienceEntry[]>([]);
  const [orgOptions, setOrgOptions] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<Record<string, string[]>>({});
  const [optionAliases, setOptionAliases] = useState<Record<string, Record<string, string>>>({});

  // Free-typed "Other" values, kept beside the dropdown selection. The old
  // editor had no such box: choosing "Other" stored the literal word "Other"
  // and wiped whatever the person had actually written.
  const [others, setOthers] = useState({ stream: '', degree: '', current_status: '', field: '', professional_course: '' });

  // Round 10: after Class 12, in the shapes lib/forms shares with registration
  // and the school's editor. `schoolAdmits` are offers the school recorded -
  // shown, never edited here. Family and home save straight away and are
  // never reviewed, because they are never published.
  const [admission, setAdmission] = useState<AdmissionDraft>(emptyAdmission());
  const [attempts, setAttempts] = useState<AttemptDraft[]>([]);
  const [admits, setAdmits] = useState<AdmitDraft[]>([]);
  const [schoolAdmits, setSchoolAdmits] = useState<string[]>([]);
  const [gap, setGap] = useState<GapDraft>(emptyGap());
  const [liveInGap, setLiveInGap] = useState(false);
  const [family, setFamily] = useState<FamilyDraft>(emptyFamily());
  const [hadPrivateRow, setHadPrivateRow] = useState(false);
  const [familyTouched, setFamilyTouched] = useState<Partial<Record<FamilyKey, boolean>>>({});
  const [linkedin, setLinkedin] = useState('');
  const [showAdmits, setShowAdmits] = useState(false);
  const [showProfessional, setShowProfessional] = useState(false);
  // "Something else" has been tapped, so the full status list is on screen.
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      void loadProfile(session.user.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProfile(userId: string) {
    setLoading(true);
    try {
      const { data, error: profileErr } = await supabase
        .from('alumni')
        .select('*, colleges(name), organizations(name)')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      if (!data) { setProfile(null); return; }

      // Anything already staged for review is what the person should see and
      // keep editing - otherwise their pending changes would look lost.
      const staged = (data.pending_changes ?? {}) as Record<string, any>;
      const {
        higher_studies: stagedStudies, work_experience: stagedWork,
        exam_attempts: stagedAttempts, admits: stagedAdmits, gap_years: stagedGaps, ...stagedColumns
      } = staged;
      const merged = normalizeProfile({ ...data, ...stagedColumns });
      setProfile(merged);
      setPicks({
        college: data.college_id && data.colleges?.name ? { id: data.college_id, name: data.colleges.name } : null,
        org: data.organization_id && data.organizations?.name ? { id: data.organization_id, name: data.organizations.name } : null,
      });

      setOthers({
        stream: splitStoredValue(merged.stream, STREAMS, LEGACY_STREAM_MAP).other,
        degree: splitStoredValue(merged.degree, DEGREES).other,
        professional_course: splitStoredValue(merged.professional_course, PROFESSIONAL_COURSES).other,
        current_status: splitStoredValue(merged.current_status, STATUSES).other,
        field: splitStoredValue(merged.field, CATEGORIES.map((c) => c.label)).other,
      });

      // The path beyond the seat: staged lists if an edit is waiting, else
      // what is saved. Owners read their own rows at any state (migration 18).
      const current = { ...data, ...stagedColumns };
      setAdmission(admissionFromRow(current));
      setLinkedin(handleFromStored(current.linkedin_handle, current.linkedin_url));
      setLiveInGap(!!data.in_gap_year);
      const classOfNum = current.class_of ? Number(current.class_of) : null;
      const [attRes, admRes, gapRes, privRes] = await Promise.all([
        supabase.from('exam_attempts').select('*').eq('alumni_id', data.id),
        supabase.from('admits').select('*, college:colleges(name)').eq('alumni_id', data.id),
        supabase.from('gap_years').select('*').eq('alumni_id', data.id),
        supabase.from('alumni_private').select('*').eq('alumni_id', data.id).maybeSingle(),
      ]);
      const savedAdmits = (admRes.data ?? []) as any[];
      const own = Array.isArray(stagedAdmits) ? stagedAdmits : savedAdmits.filter((r) => !r.added_by_school);
      // An offer stored against an exam goes back to that exam, not into the
      // "anywhere else?" block - otherwise it would show in both places.
      const drafts = pathDraftsFromRows(
        Array.isArray(stagedAttempts) ? stagedAttempts : (attRes.data ?? []), own, classOfNum);
      setAttempts(drafts.attempts);
      setAdmits(drafts.admits);
      if (drafts.admits.length) setShowAdmits(true);
      setSchoolAdmits(savedAdmits.filter((r) => r.added_by_school).map((r) =>
        [[r.degree, r.branch].filter(Boolean).join(' '), r.college?.name ?? r.college_name_raw].filter(Boolean).join(' at ')));
      setGap(gapFromRows(
        Array.isArray(stagedGaps) ? stagedGaps : (gapRes.data ?? []),
        current.in_gap_year ?? !!data.in_gap_year,
        !!(current.college_id || (current.college_name_raw ?? '').trim()),
      ));
      setFamily(familyFromRow(privRes.data));
      setHadPrivateRow(!!privRes.data);

      // Timelines: staged version if present, else what's published.
      if (Array.isArray(stagedStudies)) {
        setHigherStudies(stagedStudies.map((s: any) => ({
          degree_name: s.degree_name ?? '', institution: s.institution ?? '',
          pick: s.college_id ? { id: s.college_id, name: s.institution ?? '' } : null,
          start_year: s.start_year ? String(s.start_year) : '',
          finish_year: s.finish_year ? String(s.finish_year) : '',
        })));
      } else {
        const { data: rows } = await supabase.from('higher_studies').select('*')
          .eq('alumni_id', data.id).order('finish_year', { ascending: true });
        setHigherStudies((rows ?? []).map((r: any) => ({
          id: r.id, degree_name: r.degree_name || '', institution: r.institution || '',
          // The stored text is the college's own name, so linkFor's key check
          // matches and a save with no edit keeps the link.
          pick: r.college_id ? { id: r.college_id, name: r.institution || '' } : null,
          start_year: r.start_year ? String(r.start_year) : '',
          finish_year: r.finish_year ? String(r.finish_year) : '',
        })));
      }

      if (Array.isArray(stagedWork)) {
        setWorkExperience(stagedWork.map((w: any) => ({
          company: w.company ?? '', role: w.role ?? '',
          start_year: w.start_year ? String(w.start_year) : '',
          end_year: w.end_year ? String(w.end_year) : '', is_current: !!w.is_current,
        })));
      } else {
        const { data: rows } = await supabase.from('work_experience').select('*')
          .eq('alumni_id', data.id).order('start_year', { ascending: true });
        setWorkExperience((rows ?? []).map((r: any) => ({
          id: r.id, company: r.company || '', role: r.role || '',
          start_year: r.start_year ? String(r.start_year) : '',
          end_year: r.end_year ? String(r.end_year) : '', is_current: !!r.is_current,
        })));
      }

      const [orgs, opts, aliases] = await Promise.all([
        fetchOrganizationNames(), fetchApprovedOptions(), fetchOptionAliases(),
      ]);
      setOrgOptions(orgs);
      setTagOptions(opts);
      setOptionAliases(aliases);
    } catch (e) {
      console.error(e);
      setError('Could not load your profile details.');
    } finally {
      setLoading(false);
    }
  }

  function updateField<K extends keyof AlumnusData>(key: K, value: AlumnusData[K]) {
    setProfile((prev) => (prev ? { ...prev, [key]: value } : prev));
  }
  function updateOther(key: keyof typeof others, value: string) {
    setOthers((prev) => ({ ...prev, [key]: value }));
  }

  const streamOptions = useMemo(() => mergeOptions(STREAMS, tagOptions.stream, optionAliases.stream), [tagOptions, optionAliases]);
  const degreeOptions = useMemo(() => mergeOptions(DEGREES, tagOptions.degree, optionAliases.degree), [tagOptions, optionAliases]);
  const professionalOptions = useMemo(() => mergeOptions(PROFESSIONAL_COURSES, tagOptions.professional_course, optionAliases.professional_course), [tagOptions, optionAliases]);
  const exams = useMemo(() => examVocab(tagOptions, optionAliases), [tagOptions, optionAliases]);
  const branches = useMemo(() => branchVocab(tagOptions, optionAliases), [tagOptions, optionAliases]);
  const familyErrors = useMemo(() => familyProblems(family, false, phoneProblem), [family]);
  const statusOptions = useMemo(() => mergeOptions(STATUSES, tagOptions.current_status, optionAliases.current_status), [tagOptions, optionAliases]);
  const fieldOptions = useMemo(
    () => mergeOptions([...CATEGORIES.map((c) => c.label)], tagOptions.field, optionAliases.field),
    [tagOptions, optionAliases],
  );

  const isApproved = profile?.approval_status === 'approved';

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Resolve every "Other" selection back to the value we actually store.
      // Typing an old spelling under "Other" lands on the name the school kept.
      const canon = (category: string, value: string) => canonicalOption(optionAliases, category, value);
      const finalStream = canon('stream', resolveValue(profile.stream, others.stream));
      const finalDegree = canon('degree', resolveValue(profile.degree, others.degree));
      const finalProfessional = canon('professional_course', resolveValue(profile.professional_course, others.professional_course));
      const finalStatus = canon('current_status', resolveValue(profile.current_status, others.current_status));
      const finalField = canon('field', resolveValue(profile.field, others.field));

      if (!profile.full_name.trim()) throw new Error('Please keep your full name filled in.');
      if (!profile.personal_email.trim()) throw new Error('Please keep an email address on file.');
      if (profile.seeded_by_school && !seedConsent && consentState !== 'saved') {
        throw new Error('Please tick the box to say you are happy to appear in the directory.');
      }
      const phoneIssue = phoneProblem(profile.phone_country_code, profile.phone_number);
      if (phoneIssue) throw new Error(phoneIssue);
      // After Class 12. How the seat was got stays optional here, as the old
      // route did: a profile saved before it was asked must still be savable.
      const joined = joinedCollege(gap);
      const namedCollege = joined && !!profile.college_name.trim();
      const gapIssue = gapProblem(gap);
      if (gapIssue) throw new Error(gapIssue);
      const admissionIssue = namedCollege ? admissionProblem(admission, false) : '';
      if (admissionIssue) throw new Error(admissionIssue);
      const li = parseLinkedIn(linkedin);
      if (li.problem) throw new Error(li.problem);
      const familyIssue = Object.values(familyErrors).find(Boolean);
      if (familyIssue) throw new Error(`Family & home: ${familyIssue}`);
      // Status is no longer required to save. Registration now derives it from
      // "are you still doing this?", and rows written before that can have
      // none - blocking the save would leave those people unable to edit
      // anything at all until they picked from a dropdown they never saw.

      let photoUrl = profile.photo_url;
      if (photoFile) {
        const MAX_BYTES = 5 * 1024 * 1024;
        if (!photoFile.type.startsWith('image/')) throw new Error('Please upload an image file (JPG, PNG, WEBP…).');
        if (photoFile.size > MAX_BYTES) throw new Error('Photo is too large, please pick one under 5MB.');
        const extMatch = photoFile.name.match(/\.([a-zA-Z0-9]{1,5})$/);
        const ext = (extMatch?.[1] ?? 'jpg').toLowerCase();
        const fileName = `${profile.id}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('photos').upload(fileName, photoFile, {
          contentType: photoFile.type,
        });
        if (upErr) throw upErr;
        photoUrl = supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;
      }

      // Link institutes: the picked (or already-saved) row while the text still
      // names it, else an unambiguous exact name or alias, else the admin queue.
      const typedCollege = cleanProperNoun(profile.college_name);
      const collegeId = await linkFor('college', typedCollege, picks.college);
      const typedOrg = cleanProperNoun(profile.currently_at);
      const organizationId = await linkFor('organization', typedOrg, picks.org);

      const columns: Record<string, any> = {
        full_name: profile.full_name.trim(),
        school_name: profile.school_name,
        // Decided by the school, not asked for: see boardForSchool.
        school_board: boardForSchool(profile.school_name),
        admission_number: cleanFreeText(profile.admission_number),
        class_of: profile.class_of ? parseInt(profile.class_of, 10) : null,
        stream: finalStream || null,
        personal_email: profile.personal_email.trim(),
        phone_country_code: profile.phone_country_code,
        phone_number: profile.phone_number || null,
        // The username; the database writes linkedin_url from it.
        linkedin_handle: li.handle,
        college_id: namedCollege ? collegeId : null,
        college_name_raw: namedCollege ? typedCollege : null,
        degree: namedCollege ? (finalDegree || null) : null,
        professional_course: finalProfessional || null,
        professional_stage: finalProfessional ? (profile.professional_stage || null) : null,
        professional_org: finalProfessional ? (cleanProperNoun(profile.professional_org) || null) : null,
        branch: namedCollege
          ? cleanProperNoun(canonicalBranch(profile.branch, branches, contextualBranchAliases(finalDegree)))
          : null,
        field: finalField || null,
        // admission_route is labelled from these by a trigger (migration 18).
        ...admissionColumns(namedCollege ? admission : emptyAdmission(), exams.aliases),
        in_gap_year: inGapYear(gap),
        current_status: finalStatus,
        // Kept whatever the status says, so a finished course keeps its year.
        expected_finish_year: profile.expected_finish_year ? parseInt(profile.expected_finish_year, 10) : null,
        currently_at: typedOrg,
        organization_id: organizationId,
        designation: cleanProperNoun(profile.designation),
        message_1: cleanFreeText(profile.message_1),
        message_2: cleanFreeText(profile.message_2),
        college_thoughts: cleanFreeText(profile.college_thoughts),
        photo_url: photoUrl,
        show_photo: !!photoUrl,
        ...(profile.seeded_by_school ? { consent_given: true } : {}),
      };

      const keptStudies = higherStudies.filter((s) => s.degree_name.trim());
      const studyIds: (string | null)[] = [];
      for (const st of keptStudies) {
        studyIds.push(st.institution.trim() || st.pick
          ? await linkFor('college', cleanProperNoun(st.institution), st.pick ?? null)
          : null);
      }
      const studiesPayload = keptStudies.map((s, i) => ({
        degree_name: s.degree_name.trim(),
        college_id: studyIds[i],
        institution: cleanProperNoun(s.institution),
        start_year: s.start_year ? parseInt(s.start_year, 10) : null,
        finish_year: s.finish_year ? parseInt(s.finish_year, 10) : null,
      }));
      const workPayload = workExperience.filter((w) => w.company.trim()).map((w) => ({
        company: cleanProperNoun(w.company),
        role: cleanProperNoun(w.role),
        start_year: w.start_year ? parseInt(w.start_year, 10) : null,
        end_year: w.is_current ? null : (w.end_year ? parseInt(w.end_year, 10) : null),
        is_current: w.is_current,
      }));

      // The rest of the path, as the lists the database keeps.
      const classOfNum = profile.class_of ? parseInt(profile.class_of, 10) : null;
      const attemptPayload = attemptRows(attempts, {
        admission: namedCollege ? admission : emptyAdmission(), year: seatYear(gap, classOfNum), attemptYear: classOfNum,
      }, exams.aliases);
      const offers = allOffers(namedCollege ? admits : [], attempts).filter((d) => d.college.trim() || d.pick);
      const offerIds: Record<string, string | null> = {};
      for (const d of offers) offerIds[d.key] = await linkFor('college', cleanProperNoun(d.college), d.pick);
      const admitPayload = admitRows(offers, seatYear(gap, classOfNum), offerIds, exams.aliases).map((r) => ({
        ...r,
        branch: r.branch ? cleanProperNoun(canonicalBranch(r.branch, branches, contextualBranchAliases(r.degree ?? ''))) : null,
      }));
      const gapPayload = gapRows(gap, classOfNum, exams.aliases);

      // Email and phone are how this person signs in, and they are private, so
      // they save immediately instead of waiting in the review queue - and they
      // must stay unique across accounts.
      const contact = {
        personal_email: profile.personal_email.trim().toLowerCase(),
        phone_country_code: profile.phone_country_code,
        phone_number: profile.phone_number || null,
      };
      const { data: contactCheck, error: contactErr } = await supabase.rpc('contact_available', {
        p_email: contact.personal_email, p_phone_code: contact.phone_country_code, p_phone: contact.phone_number,
      });
      if (contactErr) throw contactErr;
      if (contactCheck?.email_free === false) throw new Error('That email is already used by another account.');
      if (contactCheck?.phone_free === false) throw new Error('That phone number is already used by another account.');
      const { personal_email: _e, phone_country_code: _c, phone_number: _p, ...contentColumns } = columns;

      // Family and home: private, never published, so never reviewed - saved
      // straight away whatever the profile's state.
      const priv = privateRow(family);
      const saysAnything = Object.entries(priv).some(([k, v]) => v && !['guardian1_phone_code', 'state'].includes(k));
      if (saysAnything || hadPrivateRow) {
        const { error: privErr } = await supabase.from('alumni_private')
          .upsert({ alumni_id: profile.id, ...priv }, { onConflict: 'alumni_id' });
        if (privErr) throw privErr;
        setHadPrivateRow(true);
      }

      if (isApproved) {
        // Entering a year out hides the page at once - the database allows the
        // owner exactly that much (migration 18). Leaving it waits for review
        // with the rest of the edit.
        const enteringGap = inGapYear(gap) && !liveInGap;
        const { error: contactSaveErr } = await supabase.from('alumni')
          .update({ ...contact, ...(enteringGap ? { in_gap_year: true } : {}) }).eq('id', profile.id);
        if (contactSaveErr) throw contactSaveErr;
        if (enteringGap) setLiveInGap(true);

        // ── Already published: stage, don't publish. ──────────────────────
        // The live columns stay exactly as they are, so the directory keeps
        // showing the approved version. This is what makes the "Edits under
        // review" message true - previously edits went live immediately and
        // the review step was decorative.
        const { error: saveErr } = await supabase
          .from('alumni')
          .update({
            pending_changes: {
              ...contentColumns, higher_studies: studiesPayload, work_experience: workPayload,
              exam_attempts: attemptPayload, admits: admitPayload, gap_years: gapPayload,
            },
            modification_status: 'pending',
            // Saving is the alumnus attesting their info - that stands even
            // while the edits wait for review. last_updated is deliberately
            // NOT set here (and never enters `columns`): the published content
            // has not changed yet; the admin's publish stamps it.
            last_confirmed_at: new Date().toISOString(),
          })
          .eq('id', profile.id);
        if (saveErr) throw saveErr;
        setSuccess('Saved. Your changes are with an administrator for review — the directory keeps showing your approved profile until then.');
      } else {
        // ── Not published yet: write straight through. ────────────────────
        const nowIso = new Date().toISOString();
        const { error: saveErr } = await supabase
          .from('alumni')
          .update({ ...columns, last_updated: nowIso, last_confirmed_at: nowIso })
          .eq('id', profile.id);
        if (saveErr) throw saveErr;

        await supabase.from('higher_studies').delete().eq('alumni_id', profile.id);
        if (studiesPayload.length) {
          await supabase.from('higher_studies').insert(studiesPayload.map((s) => ({ ...s, alumni_id: profile.id })));
        }
        await supabase.from('work_experience').delete().eq('alumni_id', profile.id);
        if (workPayload.length) {
          await supabase.from('work_experience').insert(workPayload.map((w) => ({ ...w, alumni_id: profile.id })));
        }

        // The path lists, replaced whole. Offers the school recorded stay.
        const lists: [string, Record<string, unknown>[], boolean][] = [
          ['exam_attempts', attemptPayload, false], ['admits', admitPayload, true], ['gap_years', gapPayload, false],
        ];
        for (const [table, rows, keepSchool] of lists) {
          let del = supabase.from(table).delete().eq('alumni_id', profile.id);
          if (keepSchool) del = del.eq('added_by_school', false);
          const { error: delErr } = await del;
          if (delErr) throw delErr;
          if (rows.length) {
            const { error: insErr } = await supabase.from(table).insert(rows.map((r) => ({ ...r, alumni_id: profile.id })));
            if (insErr) throw insErr;
          }
        }
        setLiveInGap(inGapYear(gap));
        setSuccess('Your details have been updated. Your profile is still awaiting its first approval.');
      }

      // Queue any new free-typed values for the admin's option review.
      if (profile.stream === OTHER_OPTION && others.stream.trim()) void proposeOption('stream', others.stream);
      if (profile.degree === OTHER_OPTION && others.degree.trim()) void proposeOption('degree', others.degree);
      if (profile.current_status === OTHER_OPTION && others.current_status.trim()) void proposeOption('current_status', others.current_status);
      // These two were missing, so an area of study or a qualification typed
      // here reached the profile but never the staff list it should join.
      if (profile.field === OTHER_OPTION && others.field.trim()) void proposeOption('field', others.field);
      if (profile.professional_course === OTHER_OPTION && others.professional_course.trim()) {
        void proposeOption('professional_course', others.professional_course);
      }

      setProfile((prev) => (prev ? { ...prev, photo_url: photoUrl, modification_status: isApproved ? 'pending' : prev.modification_status } : prev));
      setPhotoFile(null);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error
        ? err.message
        : (err && typeof err === 'object' && 'message' in err)
          ? String((err as { message: unknown }).message)
          : 'Failed to save changes.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  // One-tap "everything is still correct". Touches ONLY the confirmation
  // stamp: no staging, no review, no content change. The .select('id') matters
  // - an RLS-blocked update reports success with zero rows, and silently
  // "confirming" nothing would be worse than an error.
  async function handleConfirmAllCorrect() {
    if (!profile) return;
    setConfirming(true);
    setError('');
    try {
      const nowIso = new Date().toISOString();
      const { data, error: confErr } = await supabase
        .from('alumni')
        .update({ last_confirmed_at: nowIso })
        .eq('id', profile.id)
        .select('id');
      if (confErr) throw confErr;
      if (!data || data.length === 0) throw new Error('The confirmation did not save — please try again.');
      setProfile((prev) => (prev ? { ...prev, last_confirmed_at: nowIso } : prev));
      setSuccess('Thanks — marked as confirmed today. Juniors can trust it is current.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm just now — please try again.');
    } finally {
      setConfirming(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (loading) {
    return <div className="container container--narrow"><p className="subtitle">Loading your profile…</p></div>;
  }

  if (!profile) {
    return (
      <div className="container container--narrow">
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <h2>Profile not found</h2>
          <p className="subtitle">We couldn&apos;t find an alumni record linked to this account.</p>
          <button type="button" onClick={handleLogout} className="btn btn--neutral" style={{ marginTop: 12 }}>
            <span className="btn__inner">Log Out</span>
          </button>
        </div>
      </div>
    );
  }

  const streamSel = splitStoredValue(profile.stream, streamOptions, LEGACY_STREAM_MAP).selected;
  const degreeSel = splitStoredValue(profile.degree, degreeOptions).selected;
  const professionalSel = splitStoredValue(profile.professional_course, professionalOptions).selected;
  const joinedNow = joinedCollege(gap);
  const collegeNamed = joinedNow && !!profile.college_name.trim();
  const namesACourse = !!profile.college_name.trim() || !!profile.degree.trim();
  const professionalFields = (
    <>
      <SelectWithOther
        label="Professional qualification" options={professionalOptions} value={professionalSel}
        onChange={(v) => updateField('professional_course', v)}
        otherValue={others.professional_course} onOtherChange={(v) => updateOther('professional_course', v)}
      />
      {professionalSel && (
        <SelectField
          label="How far along?" value={profile.professional_stage}
          onChange={(v) => updateField('professional_stage', v)}
          options={PROFESSIONAL_STAGES}
          placeholder="Select stage"
        />
      )}
      {professionalSel && (
        <FloatingField
          label="Articling / studying at" hint="optional"
          value={profile.professional_org}
          onChange={(v) => updateField('professional_org', v)}
        />
      )}
    </>
  );
  const classOfNum = profile.class_of ? parseInt(profile.class_of, 10) || null : null;
  const areaKey = joinedNow
    ? (categoryForDegree(resolveValue(degreeSel, others.degree), profile.branch, resolveValue(professionalSel, others.professional_course))?.key ?? null)
    : (examAreas(gap.exam)[0] ?? null);
  const statusSel = splitStoredValue(profile.current_status, statusOptions).selected;
  const stillOnCourseNow = isInProgressStatus(resolveValue(statusSel, others.current_status));
  const finishYearPassed = namesACourse && stillOnCourseNow
    && !!profile.expected_finish_year && parseInt(profile.expected_finish_year, 10) < CURRENT_YEAR;
  // Which chip, if any, says what is already stored. Anything else - a status
  // from the longer list, or free text - opens the select instead of quietly
  // showing no chip selected while a value is saved.
  const statusChip = NOW_CHIPS.find((c) => c.status === statusSel);
  const showStatusSelect = statusOpen || (!!statusSel && !statusChip);
  const fieldSel = splitStoredValue(profile.field, fieldOptions).selected;
  const pendingReview = profile.modification_status === 'pending';

  return (
    <div className="container container--narrow">
      <div className="card fade-up">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', margin: 0 }}>My Profile</h1>
            <p className="subtitle" style={{ margin: 0 }}>Keep your journey up to date for the juniors.</p>
            {/* Only once approved: before that the page does not exist for
                anyone else, and a link to a "not found" would read as broken. */}
            {profile.approval_status === 'approved' && profile.public_slug && (
              <a href={`/alumni/${encodeURIComponent(profile.public_slug)}`} className="profile-public-link">
                See your public page, as juniors see it →
              </a>
            )}
          </div>
          <button type="button" onClick={handleLogout} className="btn btn--ghost">
            <span className="btn__inner">Log Out</span>
          </button>
        </div>

        <StatusBanner
          approval={profile.approval_status}
          pendingReview={pendingReview}
          reason={profile.approval_status === 'rejected' ? profile.rejection_reason : profile.review_note}
        />

        {/* Whenever consent is missing, not only before approval. A profile the
            school approved before its owner signed in used to hide this box -
            while saving still demanded it be ticked, so that person could never
            save anything at all. */}
        {profile.seeded_by_school && (
          <div className="welcome-card">
            <h2 className="welcome-card__title">The school started this for you</h2>
            <p>
              Your name and batch came from the school office — everything else is yours to write.
              Add your college, how you got in, and what you would tell someone in Class 12 now, then
              save. The school publishes it once you have.
            </p>
            {consentState === 'saved' ? (
              <p className="seed-consent seed-consent--done" role="status">
                ✓ Thank you — you&apos;re happy to appear in the directory. Your phone number and
                email stay private.
              </p>
            ) : (
              <label className="seed-consent">
                <input
                  type="checkbox" checked={seedConsent} disabled={consentState === 'saving'}
                  onChange={(e) => void giveConsent(e.target.checked)}
                />
                <span>
                  I&apos;m happy for this profile to appear in the alumni directory once the school
                  approves it. My phone number and email stay private.
                </span>
              </label>
            )}
            {consentState === 'failed' && (
              <p className="field__error field__error--static">
                That did not save. Check your connection and tick it again.
              </p>
            )}
          </div>
        )}

        {/* A year out that is still going on keeps the page private. The way
            back is one tap, and says what happens next. */}
        {liveInGap && gap.joinedSince !== 'yes' && (
          <div className="welcome-card">
            <h2 className="welcome-card__title">Joined a college now?</h2>
            <p>
              Your page is private while you are taking your year. Tell us where you joined and the
              school will publish it — your year out stays on it, as part of your path.
            </p>
            <button
              type="button" className="btn btn--ghost"
              onClick={() => {
                setGap((g) => ({ ...g, afterSchool: 'gap', joinedSince: 'yes' }));
                requestAnimationFrame(() => document.getElementById('profile-after12')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
              }}
            >
              <span className="btn__inner">Yes — add where I joined</span>
            </button>
          </div>
        )}

        {/* The end of registration: a card to bring the rest of the batch.
            The link names them, so a friend is greeted with who sent it. */}
        {notice.welcome && (
          <ShareCard slug={profile.public_slug || null} firstName={profile.full_name.split(' ')[0]} prominent />
        )}
        {notice.unsaved.length > 0 && (
          <div className="alert alert--error">
            Your profile saved, but your {notice.unsaved.join(' and ')} could not. Please add
            {notice.unsaved.length === 1 ? ' it' : ' them'} again below.
          </div>
        )}
        {notice.passwordUpdated && <div className="alert alert--success">Your new password is saved.</div>}

        <ProfileChecklist
          profile={profile}
          hasHigherStudies={higherStudies.some((h) => h.degree_name.trim())}
          hasWork={workExperience.some((w) => w.company.trim())}
          photoPending={!!photoFile}
          hasLinkedIn={!!parseLinkedIn(linkedin).handle}
        />

        {!profile.email_verified_at && <ConfirmEmail email={profile.personal_email} />}

        {/* Freshness, shown plainly to the owner (public surfaces keep it
            subtle). The one-tap confirm exists so an unchanged-but-accurate
            profile never has to look stale. */}
        <div className="fresh-block" id="profile-confirm">
          <div className="fresh-block__dates">
            <span>Profile updated <strong>{formatFullDate(profile.last_updated) ?? '—'}</strong></span>
            <span>Last confirmed <strong>{formatFullDate(profile.last_confirmed_at) ?? 'not yet'}</strong></span>
          </div>
          {profile.approval_status === 'approved' && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={confirming}
              onClick={handleConfirmAllCorrect}
            >
              <span className="btn__inner">{confirming ? 'Saving…' : '✓ Everything is still correct'}</span>
            </button>
          )}
        </div>

        {error && <div className="alert alert--error" style={{ marginBottom: 18 }}>{error}</div>}
        {success && <div className="alert alert--success" style={{ marginBottom: 18 }}>{success}</div>}

        <form onSubmit={handleSave}>
          {/* Photo */}
          <div id="profile-photo" className="field" style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20 }}>
            <div className="avatar" style={{ width: 80, height: 80, fontSize: '2rem' }}>
              {profile.photo_url
                ? <img src={profile.photo_url} alt="" />
                : profile.full_name.charAt(0)}
            </div>
            <div>
              <label>Update profile photo</label>
              <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} style={{ marginTop: 6 }} />
              {photoFile && <div className="hint" style={{ marginTop: 4 }}>✓ Selected: {photoFile.name}</div>}
            </div>
          </div>

          <Divider />
          <h2>Basics</h2>

          <div className="field">
            <label id="profile-school-label">School</label>
            <SchoolPicker
              labelledBy="profile-school-label"
              value={profile.school_name}
              onChange={(v) => updateField('school_name', v)}
            />
          </div>

          <FloatingField label="Full name" value={profile.full_name} onChange={(v) => updateField('full_name', v)} required />

          <div className="two-col">
            <FloatingField label="Admission number" hint="optional" value={profile.admission_number} onChange={(v) => updateField('admission_number', v)} />
            <FloatingField label="Graduating year (Class of)" type="number" max={CURRENT_YEAR} value={profile.class_of} onChange={(v) => updateField('class_of', v)} required />
          </div>

          <SelectWithOther
            label="Stream at school" options={streamOptions} value={streamSel}
            onChange={(v) => updateField('stream', v)}
            otherValue={others.stream} onOtherChange={(v) => updateOther('stream', v)}
          />

          <Divider />
          <h2 id="profile-after12">After Class 12</h2>

          <GapYearField
            value={gap} onChange={(p) => setGap((g) => ({ ...g, ...p }))}
            examOptions={exams.options} examAliases={exams.aliases}
          />

          {joinedNow && (
            <>
              {/* Not marked required here: an older profile may have none on
                  file, and a star next to an unfillable field reads as an
                  error they cannot clear. */}
              <EntitySearchField
                kind="college"
                label="College / University"
                value={profile.college_name}
                onChange={(v) => updateField('college_name', v)}
                onSelect={(hit) => setPicks((p) => ({ ...p, college: toPick(hit) }))}
              />

              <SelectWithOther
                label="Degree" options={degreeOptions} value={degreeSel}
                onChange={(v) => updateField('degree', v)}
                otherValue={others.degree} onOtherChange={(v) => updateOther('degree', v)}
              />

              <OptionSearchField
                label="Branch / Department" hint="any short form works — “CSE”, “ECE”"
                options={branches.options} aliases={branches.aliases}
                extra={contextualBranchAliases(resolveValue(degreeSel, others.degree))}
                value={profile.branch} onChange={(v) => updateField('branch', v)}
              />
            </>
          )}

          <SelectWithOther
            label="Broad area of study" options={fieldOptions} value={fieldSel}
            onChange={(v) => updateField('field', v)}
            otherValue={others.field} onOtherChange={(v) => updateOther('field', v)}
            required
          />

          {/* Folded away for anyone who has already named a course, and open for
              anyone who has not - the same rule registration uses, so the two
              forms ask this the same way (Round 11). */}
          {namesACourse ? (
            <OptionalBlock
              title="Also doing CA, CS, CMA or ACCA?"
              caption={professionalSel || 'optional — many people read for one alongside a degree'}
              open={showProfessional || !!professionalSel} onToggle={setShowProfessional}
            >
              {professionalFields}
            </OptionalBlock>
          ) : professionalFields}

          {collegeNamed && (
            <AdmissionFields
              value={admission} onChange={(p) => setAdmission((a) => ({ ...a, ...p }))}
              examOptions={exams.options} examAliases={exams.aliases}
            />
          )}

          <ExamAttemptsField
            attempts={attempts} onChange={(fn) => setAttempts(fn)}
            seatExam={collegeNamed && admission.kind === 'entrance_exam' ? admission.exam : ''}
            area={areaKey}
            examOptions={exams.options} examAliases={exams.aliases}
            classOf={classOfNum} tookGap={gap.afterSchool === 'gap'}
            degreeOptions={degreeOptions} branchOptions={branches.options} branchAliases={branches.aliases}
          />

          {collegeNamed && (
            <AdmitsField
              admits={admits} onChange={(fn) => setAdmits(fn)}
              open={showAdmits} onToggle={setShowAdmits}
              degreeOptions={degreeOptions}
              branchOptions={branches.options} branchAliases={branches.aliases}
              examOptions={exams.options} examAliases={exams.aliases}
              schoolAdded={schoolAdmits}
            />
          )}

          <Divider />
          <h2 id="profile-higher-studies">Higher studies <span className="hint">optional — add as many as you&apos;ve done</span></h2>
          {higherStudies.map((entry, i) => (
            <div key={entry.id ?? `new-${i}`} className="entry-card">
              <FloatingField label="Degree" hint="e.g. MS, MBA, PhD" value={entry.degree_name} onChange={(v) => setHigherStudies((p) => p.map((x, j) => j === i ? { ...x, degree_name: v } : x))} />
              <EntitySearchField
                kind="college" label="Institution" hint="optional — short names work, “IIT Madras”"
                value={entry.institution}
                onChange={(v) => setHigherStudies((p) => p.map((x, j) => j === i ? { ...x, institution: v, pick: null } : x))}
                onSelect={(hit) => setHigherStudies((p) => p.map((x, j) => j === i
                  ? (hit ? { ...x, institution: hit.name, pick: toPick(hit) } : { ...x, pick: null })
                  : x))}
              />
              <div className="two-col">
                <FloatingField label="Start year" hint="optional" type="number" value={entry.start_year} onChange={(v) => setHigherStudies((p) => p.map((x, j) => j === i ? { ...x, start_year: v } : x))} />
                <FloatingField label="Finish year" hint="optional" type="number" value={entry.finish_year} onChange={(v) => setHigherStudies((p) => p.map((x, j) => j === i ? { ...x, finish_year: v } : x))} />
              </div>
              <button type="button" onClick={() => setHigherStudies((p) => p.filter((_, j) => j !== i))} className="btn btn--ghost" style={{ marginTop: 8 }}>
                <span className="btn__inner">Remove</span>
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setHigherStudies((p) => [...p, emptyHigherStudy()])} className="btn btn--ghost btn--block" style={{ marginBottom: 24 }}>
            <span className="btn__inner">+ Add a degree</span>
          </button>

          <Divider />
          <h2 id="profile-now">Right now</h2>

          {/* The same question, asked the same way, as on the form they
              filled in to get here. It was an eleven-item dropdown that
              someone who answered chips at registration had never seen, and
              the full list is still one tap away for the answers chips cannot
              carry - "Studying UG" among them, which is how a current student
              arrives here in the first place. */}
          <div className="field" data-field="current_status">
            <label>What are you up to? <span className="hint">optional</span></label>
            <Chips
              options={[...NOW_CHIPS.map((c) => c.label), SOMETHING_ELSE]}
              // No chip lights up for a status the chips do not carry - the
              // select below is showing it instead, and pretending "Something
              // else" was chosen would misreport what is saved.
              value={statusChip?.label ?? (statusOpen ? SOMETHING_ELSE : '')}
              onChange={(v) => {
                if (v === SOMETHING_ELSE) { setStatusOpen(true); return; }
                const picked = NOW_CHIPS.find((c) => c.label === v);
                if (picked) { updateField('current_status', picked.status); setStatusOpen(false); }
              }}
            />
          </div>

          {showStatusSelect && (
            <SelectWithOther
              label="Or pick from the full list" options={statusOptions} value={statusSel}
              onChange={(v) => updateField('current_status', v)}
              otherValue={others.current_status} onOtherChange={(v) => updateOther('current_status', v)}
            />
          )}

          {/* Asked whenever there is a course, not only while it is in
              progress (Round 11) - a finished degree has a year too, and the
              page has nowhere else to get it from. */}
          {namesACourse && (
            <FloatingField
              label={stillOnCourseNow ? 'Which year do you finish?' : 'Which year did you finish?'}
              type="number" hint="a rough year is fine"
              min={CURRENT_YEAR - 10} max={CURRENT_YEAR + 10}
              value={profile.expected_finish_year}
              onChange={(v) => updateField('expected_finish_year', v)}
            />
          )}
          {/* The one nudge that keeps a profile from going stale: the year they
              gave us has come and gone, and nobody has asked them since. */}
          {finishYearPassed && (
            <p className="form-note form-note--warm">
              You expected to finish in {profile.expected_finish_year}. Have you? Tell us what you are doing
              now and your page catches up — it takes a minute.
            </p>
          )}

          <EntitySearchField
            kind="organization"
            label="Currently at"
            hint="company / institute, optional"
            value={profile.currently_at}
            onChange={(v) => updateField('currently_at', v)}
            onSelect={(hit) => setPicks((p) => ({ ...p, org: toPick(hit) }))}
          />
          <datalist id="profile-org-list">
            {orgOptions.map((o) => <option key={o} value={o} />)}
          </datalist>

          <FloatingField label="Role / Designation" hint="optional" value={profile.designation} onChange={(v) => updateField('designation', v)} />

          <h3 id="profile-work" style={{ marginTop: 20 }}>Work experience <span className="hint">optional — like a LinkedIn timeline</span></h3>
          {workExperience.map((entry, i) => (
            <div key={entry.id ?? `new-${i}`} className="entry-card">
              <FloatingField label="Company / Organisation" value={entry.company} onChange={(v) => setWorkExperience((p) => p.map((x, j) => j === i ? { ...x, company: v } : x))} />
              <FloatingField label="Role" hint="optional" value={entry.role} onChange={(v) => setWorkExperience((p) => p.map((x, j) => j === i ? { ...x, role: v } : x))} />
              <div className="two-col">
                <FloatingField label="Start year" hint="optional" type="number" value={entry.start_year} onChange={(v) => setWorkExperience((p) => p.map((x, j) => j === i ? { ...x, start_year: v } : x))} />
                {!entry.is_current && (
                  <FloatingField label="End year" hint="optional" type="number" value={entry.end_year} onChange={(v) => setWorkExperience((p) => p.map((x, j) => j === i ? { ...x, end_year: v } : x))} />
                )}
              </div>
              <label className="cbox-row" style={{ marginTop: 10 }}>
                <span className="cbox">
                  <input type="checkbox" checked={entry.is_current} onChange={(e) => setWorkExperience((p) => p.map((x, j) => j === i ? { ...x, is_current: e.target.checked, end_year: '' } : x))} />
                  <span className="cbox__mark" />
                </span>
                <span>I currently work here</span>
              </label>
              <button type="button" onClick={() => setWorkExperience((p) => p.filter((_, j) => j !== i))} className="btn btn--ghost" style={{ marginTop: 8 }}>
                <span className="btn__inner">Remove</span>
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setWorkExperience((p) => [...p, emptyWorkExperience()])} className="btn btn--ghost btn--block" style={{ marginBottom: 24 }}>
            <span className="btn__inner">+ Add work experience</span>
          </button>

          {/* Public, so not under "Contact": it sat beneath a heading saying
              "never shown publicly" while its own hint said the opposite. */}
          <div id="profile-linkedin" style={{ marginTop: 20 }}>
            <LinkedInField value={linkedin} onChange={setLinkedin} />
          </div>

          <Divider />
          <h2 id="profile-contact">Contact <span className="hint">never shown publicly</span></h2>

          <FloatingField label="Email" type="email" value={profile.personal_email} onChange={(v) => updateField('personal_email', v)} required />
          <div className="two-col">
            <FloatingSelect label="Country code" value={profile.phone_country_code} onChange={(v) => updateField('phone_country_code', v)} options={COUNTRY_CODES} />
            <FloatingField label="Phone number" type="tel" value={profile.phone_number} onChange={(v) => updateField('phone_number', v.replace(/\D/g, ''))} required />
          </div>

          <Divider />
          <h2 id="profile-family">Family &amp; home 🔒 <span className="hint">saved straight away, never reviewed or shown</span></h2>
          <FamilyHomeFields
            value={family} onChange={(p) => setFamily((f) => ({ ...f, ...p }))}
            problems={familyErrors} touched={familyTouched}
            onTouch={(k) => setFamilyTouched((t) => ({ ...t, [k]: true }))}
            studentPhone={profile.phone_number}
          />

          <Divider />
          <div id="profile-advice" className="field" style={{ marginTop: 20 }}>
            <label>One thing you&apos;d tell your junior self?</label>
            <textarea value={profile.message_1} onChange={(e) => updateField('message_1', e.target.value)} placeholder="e.g. don't stress over one bad exam, or start applying early…" />
            <span className="hint">This is the part juniors actually read.</span>
          </div>

          <div className="field" style={{ marginTop: 20 }}>
            <label>Anything you&apos;d do differently? <span className="opt">optional</span></label>
            <textarea
              value={profile.message_2}
              onChange={(e) => updateField('message_2', e.target.value)}
              placeholder="e.g. I'd have started preparing a year earlier, or picked a different branch…"
            />
            <span className="hint">Shown under your first piece of advice.</span>
          </div>

          <div id="profile-college-thoughts" className="field" style={{ marginTop: 20 }}>
            <label>Your experience at your college <span className="opt">optional</span></label>
            <textarea
              value={profile.college_thoughts}
              onChange={(e) => updateField('college_thoughts', e.target.value)}
              placeholder="What is it actually like there? Hostel, teachers, workload, the thing brochures don't say…"
            />
            <span className="hint">Shown on your page, with what you have to say — juniors choosing a college read this.</span>
          </div>

          {!notice.welcome && (
            <div style={{ marginTop: 24 }}>
              <ShareCard slug={profile.public_slug || null} firstName={profile.full_name.split(' ')[0]} />
            </div>
          )}

          <button type="submit" disabled={saving} className="btn btn--neutral btn--lg btn--block" style={{ marginTop: 24 }}>
            <span className="btn__inner">
              {saving ? <span className="spinner spinner--neutral" /> : isApproved ? 'Submit changes for review 💾' : 'Save changes 💾'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}

/* ----- Small pieces ------------------------------------------------------- */

/**
 * What the school has decided, and - at last - why.
 *
 * "Please contact the school office" was all anyone was ever told, while the
 * reason the office had typed sat unread in the row. A person who is told what
 * to fix can fix it; a person told to ring up mostly does not.
 */
function StatusBanner({ approval, pendingReview, reason }: {
  approval: string; pendingReview: boolean; reason?: string;
}) {
  const said = (reason ?? '').trim();
  const [tone, text] =
    approval === 'pending'
      ? ['warn', 'Pending verification — an administrator is reviewing your profile.']
      : approval === 'rejected'
        ? ['danger', said
          ? 'This profile was not approved.'
          : 'This profile was not approved. Please contact the school office.']
        : pendingReview
          ? ['warn', 'Edits under review — the directory shows your last approved version until staff publish the changes.']
          : ['ok', 'Verified and live on the directory ✨'];

  return (
    <div className={`status-banner status-banner--${tone}`}>
      <strong>Profile status: </strong>{text}
      {said && (approval === 'rejected' || approval === 'approved') && (
        <p className="status-banner__said">
          <strong>From the school:</strong> {said}
        </p>
      )}
    </div>
  );
}

function Divider() {
  return <hr style={{ border: 'none', borderBottom: '1px solid var(--border)', margin: '24px 0' }} />;
}

function FloatingField({
  label, hint, value, onChange, type = 'text', list, style, min, max, step, required,
}: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  type?: string; list?: string; style?: React.CSSProperties;
  min?: number; max?: number; step?: number; required?: boolean;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const [focused, setFocused] = useState(false);
  const active = focused || (value && value.trim().length > 0);
  return (
    <div className={`f-field${active ? ' f-field--active' : ''}`} style={style}>
      <input
        id={id} type={type} list={list} value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        placeholder="" min={min} max={max} step={step} aria-required={required}
      />
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden> *</span>}</label>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function FloatingSelect({ label, value, onChange, options }: {
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

/** A dropdown that reveals a "please specify" box when "Other" is chosen. */
function SelectField({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
  placeholder?: string;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="field">
      <div className="f-field f-field--active">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <label htmlFor={id}>{label}</label>
      </div>
    </div>
  );
}

function SelectWithOther({
  label, options, value, onChange, otherValue, onOtherChange, required,
}: {
  label: string; options: string[]; value: string; onChange: (v: string) => void;
  otherValue: string; onOtherChange: (v: string) => void; required?: boolean;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="field">
      <div className="f-field f-field--active">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-required={required}>
          <option value="" disabled hidden>Select {label.toLowerCase()}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <label htmlFor={id}>{label}{required && <span className="req" aria-hidden> *</span>}</label>
      </div>
      {value === OTHER_OPTION && (
        <>
          <FloatingField label="Please specify" value={otherValue} onChange={onOtherChange} style={{ marginTop: 10 }} />
          <p className="hint" style={{ display: 'block', marginTop: 4 }}>
            New entries are checked by staff before they join the list for everyone.
          </p>
        </>
      )}
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

/* ─────────────────────────────────────────────────────────────────────────
   Profile checklist
   What a junior would miss on this profile, in the order it matters to them,
   each with a jump to the field. Hidden once everything is done.
───────────────────────────────────────────────────────────────────────── */
/**
 * "Is this the right address?" - shown until it has been proved once.
 *
 * Deliberately not an alarm: the profile works either way, and the school
 * approves it either way. It matters for the day they need a password reset.
 */
function ConfirmEmail({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [note, setNote] = useState('');

  async function send() {
    setState('sending');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const body = (await res.json()) as { sent?: boolean; reason?: string; message?: string };
      if (body.sent) {
        setState('sent');
        setNote(`Sent to ${email}. It can take a minute, and it sometimes lands in spam.`);
      } else if (body.reason === 'already-verified') {
        setState('sent');
        setNote('This address is already confirmed.');
      } else if (body.reason === 'throttled') {
        setState('sent');
        setNote(body.message ?? 'We have just sent one — please check your inbox.');
      } else {
        setState('failed');
        setNote('The school is still setting up email. Nothing is wrong with your profile — this can wait.');
      }
    } catch {
      setState('failed');
      setNote('We could not reach the server. Please try again in a moment.');
    }
  }

  return (
    <div className="status-banner status-banner--warn" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      <span style={{ flex: '1 1 260px' }}>
        <strong>Confirm your email.</strong>{' '}
        {note || `We sent a link to ${email} when you registered. Confirming it means a password reset would actually reach you.`}
      </span>
      {state !== 'sent' && (
        <button type="button" className="btn btn--ghost" disabled={state === 'sending'} onClick={send}>
          <span className="btn__inner">{state === 'sending' ? 'Sending…' : 'Send it again'}</span>
        </button>
      )}
    </div>
  );
}

function ProfileChecklist({
  profile, hasHigherStudies, hasWork, photoPending, hasLinkedIn,
}: {
  profile: AlumnusData;
  hasHigherStudies: boolean;
  hasWork: boolean;
  photoPending: boolean;
  hasLinkedIn: boolean;
}) {
  const confirmedRecently = !!profile.last_confirmed_at
    && Date.now() - new Date(profile.last_confirmed_at).getTime() < 365 * 24 * 3600 * 1000;
  const items = [
    { done: !!profile.email_verified_at, label: 'Confirm your email', why: 'so a password reset reaches you', href: '#profile-contact' },
    { done: !!profile.photo_url || photoPending, label: 'Add a photo', why: 'what juniors notice first', href: '#profile-photo' },
    { done: !!profile.message_1.trim(), label: 'A line of advice for your junior self', why: 'the part juniors read most', href: '#profile-advice' },
    { done: !!profile.college_thoughts.trim(), label: 'What your college is really like', why: 'helps someone choosing it', href: '#profile-college-thoughts' },
    { done: hasHigherStudies || hasWork, label: 'Higher studies or work experience', why: 'shows where the path led', href: hasWork ? '#profile-work' : '#profile-higher-studies' },
    // Registration no longer makes anyone pick a label for this, so the
    // nudge lives here instead - where it can be ignored without abandoning
    // a form half way through.
    { done: !!profile.current_status.trim(), label: "Say what you're doing now", why: 'juniors filter by it', href: '#profile-now' },
    { done: hasLinkedIn, label: 'Your LinkedIn', why: 'so juniors can reach out', href: '#profile-linkedin' },
    { done: confirmedRecently, label: 'Confirm your details this year', why: 'keeps your profile trusted', href: '#profile-confirm' },
  ];
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  const pct = Math.round((done / items.length) * 100);

  return (
    <section className="checklist" aria-label="Profile checklist">
      <div className="checklist__head">
        <strong>Your profile is {pct}% complete</strong>
        <span>{done} of {items.length}</span>
      </div>
      <div className="checklist__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <ul className="checklist__items">
        {items.filter((i) => !i.done).map((i) => (
          <li key={i.label}>
            <a href={i.href}>{i.label}</a>
            <span> — {i.why}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
