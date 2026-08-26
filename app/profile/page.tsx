'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import EntitySearchField from '../../lib/EntitySearchField';
import { cleanFreeText, cleanProperNoun , formatFullDate } from '../../lib/text';
import { fetchApprovedOptions, fetchOrganizationNames, proposeOption } from '../../lib/publicData';
import {
  SCHOOLS, STREAMS, DEGREES, ADMISSION_ROUTES, STATUSES, SCHOOL_BOARDS,
  COUNTRY_CODES, OTHER_OPTION, LEGACY_STREAM_MAP, officialSchoolName,
  PROFESSIONAL_COURSES, PROFESSIONAL_STAGES,
  isInProgressStatus, mergeOptions, splitStoredValue, resolveValue,
} from '../../lib/options';
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
  last_updated: string | null;
  last_confirmed_at: string | null;
  college_thoughts: string;
}

interface HigherStudyEntry {
  id?: string;
  degree_name: string; institution: string; start_year: string; finish_year: string;
}
interface WorkExperienceEntry {
  id?: string;
  company: string; role: string; start_year: string; end_year: string; is_current: boolean;
}

const emptyHigherStudy = (): HigherStudyEntry => ({ degree_name: '', institution: '', start_year: '', finish_year: '' });
const emptyWorkExperience = (): WorkExperienceEntry => ({ company: '', role: '', start_year: '', end_year: '', is_current: false });

const CURRENT_YEAR = new Date().getFullYear();

/**
 * The DB allows most of these to be null, but every .trim() here assumes a
 * string. Loading a raw row straight into state used to crash the save with
 * "Cannot read properties of null (reading 'trim')", so normalise on the way in.
 */
function normalizeProfile(raw: any): AlumnusData {
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    ...raw,
    full_name: str(raw.full_name),
    username: str(raw.username),
    school_name: officialSchoolName(raw.school_name),
    admission_number: str(raw.admission_number),
    class_of: raw.class_of ? String(raw.class_of) : '',
    stream: str(raw.stream),
    school_board: str(raw.school_board),
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
    last_updated: raw.last_updated ?? null,
    last_confirmed_at: raw.last_confirmed_at ?? null,
    college_thoughts: str(raw.college_thoughts),
  };
}

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [profile, setProfile] = useState<AlumnusData | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [higherStudies, setHigherStudies] = useState<HigherStudyEntry[]>([]);
  const [workExperience, setWorkExperience] = useState<WorkExperienceEntry[]>([]);
  const [orgOptions, setOrgOptions] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<Record<string, string[]>>({});

  // Free-typed "Other" values, kept beside the dropdown selection. The old
  // editor had no such box: choosing "Other" stored the literal word "Other"
  // and wiped whatever the person had actually written.
  const [others, setOthers] = useState({ stream: '', degree: '', admission_route: '', current_status: '', field: '', school_board: '', professional_course: '' });

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
        .select('*, colleges(name)')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      if (!data) { setProfile(null); return; }

      // Anything already staged for review is what the person should see and
      // keep editing - otherwise their pending changes would look lost.
      const staged = (data.pending_changes ?? {}) as Record<string, any>;
      const { higher_studies: stagedStudies, work_experience: stagedWork, ...stagedColumns } = staged;
      const merged = normalizeProfile({ ...data, ...stagedColumns });
      setProfile(merged);

      setOthers({
        stream: splitStoredValue(merged.stream, STREAMS, LEGACY_STREAM_MAP).other,
        degree: splitStoredValue(merged.degree, DEGREES).other,
        professional_course: splitStoredValue(merged.professional_course, PROFESSIONAL_COURSES).other,
        admission_route: splitStoredValue(merged.admission_route, ADMISSION_ROUTES).other,
        current_status: splitStoredValue(merged.current_status, STATUSES).other,
        field: splitStoredValue(merged.field, CATEGORIES.map((c) => c.label)).other,
        school_board: splitStoredValue(merged.school_board, SCHOOL_BOARDS).other,
      });

      // Timelines: staged version if present, else what's published.
      if (Array.isArray(stagedStudies)) {
        setHigherStudies(stagedStudies.map((s: any) => ({
          degree_name: s.degree_name ?? '', institution: s.institution ?? '',
          start_year: s.start_year ? String(s.start_year) : '',
          finish_year: s.finish_year ? String(s.finish_year) : '',
        })));
      } else {
        const { data: rows } = await supabase.from('higher_studies').select('*')
          .eq('alumni_id', data.id).order('finish_year', { ascending: true });
        setHigherStudies((rows ?? []).map((r: any) => ({
          id: r.id, degree_name: r.degree_name || '', institution: r.institution || '',
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

      const [orgs, opts] = await Promise.all([fetchOrganizationNames(), fetchApprovedOptions()]);
      setOrgOptions(orgs);
      setTagOptions(opts);
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

  const streamOptions = useMemo(() => mergeOptions(STREAMS, tagOptions.stream), [tagOptions]);
  const degreeOptions = useMemo(() => mergeOptions(DEGREES, tagOptions.degree), [tagOptions]);
  const professionalOptions = useMemo(() => mergeOptions(PROFESSIONAL_COURSES, tagOptions.professional_course), [tagOptions]);
  const routeOptions = useMemo(() => mergeOptions(ADMISSION_ROUTES, tagOptions.admission_route), [tagOptions]);
  const statusOptions = useMemo(() => mergeOptions(STATUSES, tagOptions.current_status), [tagOptions]);
  const fieldOptions = useMemo(
    () => mergeOptions([...CATEGORIES.map((c) => c.label)], tagOptions.field),
    [tagOptions],
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
      const finalStream = resolveValue(profile.stream, others.stream);
      const finalDegree = resolveValue(profile.degree, others.degree);
      const finalProfessional = resolveValue(profile.professional_course, others.professional_course);
      const finalRoute = resolveValue(profile.admission_route, others.admission_route);
      const finalStatus = resolveValue(profile.current_status, others.current_status);
      const finalField = resolveValue(profile.field, others.field);
      const finalBoard = resolveValue(profile.school_board, others.school_board);

      if (!profile.full_name.trim()) throw new Error('Please keep your full name filled in.');
      if (!profile.personal_email.trim()) throw new Error('Please keep an email address on file.');
      if (!profile.phone_number.trim()) throw new Error('Please keep a phone number on file.');
      if (!finalStatus) throw new Error('Please select your current status.');

      let photoUrl = profile.photo_url;
      if (photoFile) {
        const MAX_BYTES = 5 * 1024 * 1024;
        if (!photoFile.type.startsWith('image/')) throw new Error('Please upload an image file (JPG, PNG, WEBP…).');
        if (photoFile.size > MAX_BYTES) throw new Error('Photo is too large, please pick one under 5MB.');
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

      // Match the typed college against the reference table.
      let collegeId: string | null = null;
      const typedCollege = cleanProperNoun(profile.college_name);
      if (typedCollege) {
        const { data: existing } = await supabase.from('colleges').select('id').ilike('name', typedCollege).maybeSingle();
        if (existing) collegeId = existing.id;
      }
      let organizationId: string | null = null;
      const typedOrg = cleanProperNoun(profile.currently_at);
      if (typedOrg) {
        const { data: existing } = await supabase.from('organizations').select('id').ilike('name', typedOrg).maybeSingle();
        if (existing) organizationId = existing.id;
      }

      const columns: Record<string, any> = {
        full_name: profile.full_name.trim(),
        school_name: profile.school_name,
        school_board: finalBoard || null,
        admission_number: cleanFreeText(profile.admission_number),
        class_of: profile.class_of ? parseInt(profile.class_of, 10) : null,
        stream: finalStream || null,
        personal_email: profile.personal_email.trim(),
        phone_country_code: profile.phone_country_code,
        phone_number: profile.phone_number || null,
        linkedin_url: profile.linkedin_url.trim() || null,
        college_id: collegeId,
        college_name_raw: typedCollege,
        degree: finalDegree || null,
        professional_course: finalProfessional || null,
        professional_stage: finalProfessional ? (profile.professional_stage || null) : null,
        professional_org: finalProfessional ? (cleanProperNoun(profile.professional_org) || null) : null,
        branch: cleanProperNoun(profile.branch),
        field: finalField || null,
        admission_route: finalRoute || null,
        admission_rank: cleanFreeText(profile.admission_rank),
        board_marks: cleanFreeText(profile.board_marks),
        board_cutoff: cleanFreeText(profile.board_cutoff),
        current_status: finalStatus,
        expected_finish_year: isInProgressStatus(finalStatus) && profile.expected_finish_year
          ? parseInt(profile.expected_finish_year, 10) : null,
        currently_at: typedOrg,
        organization_id: organizationId,
        designation: cleanProperNoun(profile.designation),
        message_1: cleanFreeText(profile.message_1),
        message_2: cleanFreeText(profile.message_2),
        college_thoughts: cleanFreeText(profile.college_thoughts),
        photo_url: photoUrl,
        show_photo: !!photoUrl,
      };

      const studiesPayload = higherStudies.filter((s) => s.degree_name.trim()).map((s) => ({
        degree_name: s.degree_name.trim(),
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

      if (isApproved) {
        // ── Already published: stage, don't publish. ──────────────────────
        // The live columns stay exactly as they are, so the directory keeps
        // showing the approved version. This is what makes the "Edits under
        // review" message true - previously edits went live immediately and
        // the review step was decorative.
        const { error: saveErr } = await supabase
          .from('alumni')
          .update({
            pending_changes: { ...columns, higher_studies: studiesPayload, work_experience: workPayload },
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
        setSuccess('Your details have been updated. Your profile is still awaiting its first approval.');
      }

      // Queue any new free-typed values for the admin's option review.
      if (profile.stream === OTHER_OPTION && others.stream.trim()) void proposeOption('stream', others.stream);
      if (profile.degree === OTHER_OPTION && others.degree.trim()) void proposeOption('degree', others.degree);
      if (profile.admission_route === OTHER_OPTION && others.admission_route.trim()) void proposeOption('admission_route', others.admission_route);
      if (profile.current_status === OTHER_OPTION && others.current_status.trim()) void proposeOption('current_status', others.current_status);

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
  const routeSel = splitStoredValue(profile.admission_route, routeOptions).selected;
  const statusSel = splitStoredValue(profile.current_status, statusOptions).selected;
  const fieldSel = splitStoredValue(profile.field, fieldOptions).selected;
  const boardSel = splitStoredValue(profile.school_board, SCHOOL_BOARDS).selected;
  const pendingReview = profile.modification_status === 'pending';

  return (
    <main className="container container--narrow">
      <div className="card fade-up">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', margin: 0 }}>My Profile</h1>
            <p className="subtitle" style={{ margin: 0 }}>Keep your journey up to date for the juniors.</p>
          </div>
          <button type="button" onClick={handleLogout} className="btn btn--ghost">
            <span className="btn__inner">Log Out</span>
          </button>
        </div>

        <StatusBanner approval={profile.approval_status} pendingReview={pendingReview} />

        {/* Freshness, shown plainly to the owner (public surfaces keep it
            subtle). The one-tap confirm exists so an unchanged-but-accurate
            profile never has to look stale. */}
        <div className="fresh-block">
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
          <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20 }}>
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
          <h3>Basics</h3>

          <div className="field">
            <label>School</label>
            <Chips options={[...SCHOOLS]} value={profile.school_name} onChange={(v) => updateField('school_name', v)} />
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

          <SelectWithOther
            label="School board" options={SCHOOL_BOARDS} value={boardSel}
            onChange={(v) => updateField('school_board', v)}
            otherValue={others.school_board} onOtherChange={(v) => updateOther('school_board', v)}
          />

          <Divider />
          <h3>Higher education</h3>

          <SelectWithOther
            label="Broad area of study" options={fieldOptions} value={fieldSel}
            onChange={(v) => updateField('field', v)}
            otherValue={others.field} onOtherChange={(v) => updateOther('field', v)}
            required
          />

          {/* Not marked required here: someone reading for CA has no college
              and no degree, and a star next to an unfillable field just reads
              as an error they cannot clear. */}
          <EntitySearchField
            table="colleges"
            label="College / University"
            hint="leave blank if you didn't join one"
            value={profile.college_name}
            onChange={(v) => updateField('college_name', v)}
            searchShortNames
          />

          <SelectWithOther
            label="Degree" options={degreeOptions} value={degreeSel}
            onChange={(v) => updateField('degree', v)}
            otherValue={others.degree} onOtherChange={(v) => updateOther('degree', v)}
          />

          <FloatingField label="Branch / Department" hint="optional" value={profile.branch} onChange={(v) => updateField('branch', v)} />

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

          <SelectWithOther
            label="How you got in" options={routeOptions} value={routeSel}
            onChange={(v) => updateField('admission_route', v)}
            otherValue={others.admission_route} onOtherChange={(v) => updateOther('admission_route', v)}
          />

          {routeSel === 'Board Marks' ? (
            <div className="two-col">
              <FloatingField label="Board marks (%)" type="number" min={0} max={100} step={0.01} value={profile.board_marks} onChange={(v) => updateField('board_marks', v)} />
              <FloatingField label="Cutoff" hint="if applicable" value={profile.board_cutoff} onChange={(v) => updateField('board_cutoff', v)} />
            </div>
          ) : (
            !['Merit / Direct', OTHER_OPTION, ''].includes(routeSel) && (
              <FloatingField label="Admission rank" hint="optional" type="number" min={1} value={profile.admission_rank} onChange={(v) => updateField('admission_rank', v.replace(/[^\d]/g, ''))} />
            )
          )}

          <Divider />
          <h3>Higher studies <span className="hint">optional — add as many as you&apos;ve done</span></h3>
          {higherStudies.map((entry, i) => (
            <div key={entry.id ?? `new-${i}`} className="entry-card">
              <FloatingField label="Degree" hint="e.g. MS, MBA, PhD" value={entry.degree_name} onChange={(v) => setHigherStudies((p) => p.map((x, j) => j === i ? { ...x, degree_name: v } : x))} />
              <FloatingField label="Institution" hint="optional" value={entry.institution} onChange={(v) => setHigherStudies((p) => p.map((x, j) => j === i ? { ...x, institution: v } : x))} />
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
          <h3>Right now</h3>

          <SelectWithOther
            label="What are you up to?" options={statusOptions} value={statusSel}
            onChange={(v) => updateField('current_status', v)}
            otherValue={others.current_status} onOtherChange={(v) => updateOther('current_status', v)}
            required
          />

          {isInProgressStatus(resolveValue(statusSel, others.current_status)) && (
            <FloatingField
              label="Expected to finish in (year)" type="number"
              min={CURRENT_YEAR - 10} max={CURRENT_YEAR + 10}
              value={profile.expected_finish_year}
              onChange={(v) => updateField('expected_finish_year', v)}
            />
          )}

          <EntitySearchField
            table="organizations"
            label="Currently at"
            hint="company / institute, optional"
            value={profile.currently_at}
            onChange={(v) => updateField('currently_at', v)}
          />
          <datalist id="profile-org-list">
            {orgOptions.map((o) => <option key={o} value={o} />)}
          </datalist>

          <FloatingField label="Role / Designation" hint="optional" value={profile.designation} onChange={(v) => updateField('designation', v)} />

          <h4 style={{ marginTop: 20 }}>Work experience <span className="hint">optional — like a LinkedIn timeline</span></h4>
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

          <Divider />
          <h3>Contact <span className="hint">never shown publicly</span></h3>

          <FloatingField label="LinkedIn profile URL" hint="optional, shown publicly" type="url" value={profile.linkedin_url} onChange={(v) => updateField('linkedin_url', v)} />
          <FloatingField label="Email" type="email" value={profile.personal_email} onChange={(v) => updateField('personal_email', v)} required />
          <div className="two-col">
            <FloatingSelect label="Country code" value={profile.phone_country_code} onChange={(v) => updateField('phone_country_code', v)} options={COUNTRY_CODES} />
            <FloatingField label="Phone number" type="tel" value={profile.phone_number} onChange={(v) => updateField('phone_number', v.replace(/\D/g, ''))} required />
          </div>

          <div className="field" style={{ marginTop: 20 }}>
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

          <div className="field" style={{ marginTop: 20 }}>
            <label>Your experience at your college <span className="opt">optional</span></label>
            <textarea
              value={profile.college_thoughts}
              onChange={(e) => updateField('college_thoughts', e.target.value)}
              placeholder="What is it actually like there? Hostel, teachers, workload, the thing brochures don't say…"
            />
            <span className="hint">Shown with your college in the College Explorer — juniors choosing a college read this.</span>
          </div>

          <button type="submit" disabled={saving} className="btn btn--neutral btn--lg btn--block" style={{ marginTop: 24 }}>
            <span className="btn__inner">
              {saving ? <span className="spinner" /> : isApproved ? 'Submit changes for review 💾' : 'Save changes 💾'}
            </span>
          </button>
        </form>
      </div>
    </main>
  );
}

/* ----- Small pieces ------------------------------------------------------- */

function StatusBanner({ approval, pendingReview }: { approval: string; pendingReview: boolean }) {
  const [tone, text] =
    approval === 'pending'
      ? ['warn', 'Pending verification — an administrator is reviewing your profile.']
      : approval === 'rejected'
        ? ['danger', 'This profile was not approved. Please contact the school office.']
        : pendingReview
          ? ['warn', 'Edits under review — the directory shows your last approved version until staff publish the changes.']
          : ['ok', 'Verified and live on the directory ✨'];

  return <div className={`status-banner status-banner--${tone}`}><strong>Profile status: </strong>{text}</div>;
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
