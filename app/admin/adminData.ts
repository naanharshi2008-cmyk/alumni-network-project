/**
 * What the dashboard reads, and the shapes it reads into.
 *
 * Split out of the admin page along with the page itself: Review, People and
 * Data each load their own data now, rather than one loader on mount fetching
 * all eight of the old tabs whether or not anyone opened them.
 *
 * Every list read asks for an exact count, so a result silently capped by
 * PostgREST is detectable (`count > rows.length`) rather than quietly wrong.
 */

import { supabase } from '../../lib/supabaseClient';
import { instKey } from '../../lib/instituteKey';
import type { OptionRow } from './ValueMerge';

export const ADMIN_LOGIN_DOMAIN = 'veveaham-admin.local';
export const LAST_VISIT_KEY = 'veveaham.admin.lastVisit';

/** Enough rows for any real queue; the count tells us when it was not. */
export const PAGE = 200;

export type AlumniRow = {
  id: string;
  full_name: string;
  username: string | null;
  user_id: string | null;
  public_slug?: string | null;
  admission_number: string | null;
  school_name: string | null;
  class_of: number;
  stream: string;
  school_board: string | null;
  college_name_raw: string | null;
  college_id: string | null;
  organization_id: string | null;
  degree: string | null;
  professional_course: string | null;
  professional_stage: string | null;
  professional_org: string | null;
  branch: string | null;
  field: string | null;
  admission_route: string | null;
  admission_rank: string | null;
  board_marks: string | null;
  board_cutoff: string | null;
  current_status: string | null;
  expected_finish_year: number | null;
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
  pending_changes: Record<string, any> | null;
  created_at: string;
  last_updated: string | null;
  last_confirmed_at: string | null;
  school_note: string | null;
  college_thoughts: string | null;
  featured?: boolean | null;
  email_verified_at?: string | null;
  // False on a row the school entered itself: nobody has agreed to anything
  // yet, and the profile is a stub until they sign in and fill it in.
  consent_given?: boolean | null;
};

export type HigherStudyRow = {
  id: string; alumni_id: string; degree_name: string;
  institution: string | null; start_year: number | null; finish_year: number | null;
};

export type WorkExperienceRow = {
  id: string; alumni_id: string; company: string; role: string | null;
  start_year: number | null; end_year: number | null; is_current: boolean;
};

export type PendingOption = { id: number; category: string; value: string; created_at: string };

export type CollegeInfoRow = {
  id: string;
  name: string;
  state: string | null;
  district: string | null;
  banner_url: string | null;
  logo_url: string | null;
  description: string | null;
  students: { id: string; full_name: string; class_of: number | null; school_note: string | null }[];
};

export type PendingPhoto = {
  id: string;
  url: string;
  caption: string | null;
  created_at: string;
  college: { name: string } | { name: string }[] | null;
  alumni: { full_name: string; class_of: number | null } | { full_name: string; class_of: number | null }[] | null;
};


// Fields the profile editor may change, and how to label them in the diff.
export const FIELD_LABELS: Record<string, string> = {
  full_name: 'Full Name', school_name: 'School',
  class_of: 'Class Of', stream: 'Stream', degree: 'Degree', branch: 'Branch',
  field: 'Field', college_name_raw: 'College', currently_at: 'Currently At',
  professional_course: 'Professional course', professional_stage: 'Stage',
  professional_org: 'Articling / studying at',
  designation: 'Designation', current_status: 'Status',
  expected_finish_year: 'Expected Finish', admission_route: 'Admission Route',
  admission_rank: 'Rank', board_marks: 'Board Marks', board_cutoff: 'Cutoff',
  message_1: 'Advice', message_2: 'Advice (second)', college_thoughts: 'College experience', linkedin_url: 'LinkedIn', photo_url: 'Photo',
};

export type TypedNameGroup = { key: string; display: string; alumniIds: string[]; waitingSince?: string };

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────────────────── */
export function groupByTypedName(rows: any[], column: string): TypedNameGroup[] {
  const groups: Record<string, { display: string; alumniIds: string[]; waitingSince?: string }> = {};
  for (const row of rows) {
    const raw = (row[column] ?? '').trim();
    if (!raw) continue;
    // Spacing, case and punctuation never make a different institute.
    const key = instKey(raw) || raw.toLowerCase();
    if (!groups[key]) groups[key] = { display: raw, alumniIds: [] };
    groups[key].alumniIds.push(row.id);
    // The group has waited as long as its oldest member.
    const at = row.created_at as string | undefined;
    if (at && (!groups[key].waitingSince || at < groups[key].waitingSince!)) {
      groups[key].waitingSince = at;
    }
  }
  return Object.entries(groups)
    .map(([key, v]) => ({ key, display: v.display, alumniIds: v.alumniIds, waitingSince: v.waitingSince }))
    .sort((a, b) => b.alumniIds.length - a.alumniIds.length);
}


export type Counts = { registrations: number; edits: number; photos: number; options: number };

/** The nav badges. Four head-only requests, no rows over the wire. */
export async function loadCounts(): Promise<Counts> {
  const [reg, edits, photos, options] = await Promise.all([
    supabase.from('alumni').select('id', { head: true, count: 'exact' }).eq('approval_status', 'pending'),
    supabase.from('alumni').select('id', { head: true, count: 'exact' })
      .eq('approval_status', 'approved').eq('modification_status', 'pending'),
    supabase.from('college_photos').select('id', { head: true, count: 'exact' }).eq('status', 'pending'),
    supabase.from('field_options').select('id', { head: true, count: 'exact' }).eq('status', 'pending'),
  ]);
  return {
    registrations: reg.count ?? 0,
    edits: edits.count ?? 0,
    photos: photos.count ?? 0,
    options: options.count ?? 0,
  };
}

export type ReviewData = {
  pending: AlumniRow[];
  pendingEdits: AlumniRow[];
  photos: PendingPhoto[];
  options: PendingOption[];
  optionRows: OptionRow[];
  approvedOptions: Record<string, string[]>;
  unmatchedColleges: TypedNameGroup[];
  unmatchedCompanies: TypedNameGroup[];
  higherStudies: Record<string, HigherStudyRow[]>;
  workExperience: Record<string, WorkExperienceRow[]>;
  error: string;
};

/** Everything waiting for a decision, and nothing else. */
export async function loadReview(): Promise<ReviewData> {
  const [reg, edits, photoRes, optRes, colRes, orgRes] = await Promise.all([
    supabase.from('alumni').select('*').eq('approval_status', 'pending')
      .order('created_at', { ascending: true }).limit(PAGE),
    supabase.from('alumni').select('*').eq('approval_status', 'approved')
      .eq('modification_status', 'pending').order('created_at', { ascending: true }).limit(PAGE),
    supabase.from('college_photos')
      .select('id, url, caption, created_at, colleges(name), alumni(full_name, class_of)')
      .eq('status', 'pending').order('created_at', { ascending: true }).limit(PAGE),
    supabase.from('field_options').select('id, category, value, status, canonical_value, created_at')
      .order('created_at', { ascending: true }),
    supabase.from('alumni').select('id, college_name_raw, created_at')
      .is('college_id', null).not('college_name_raw', 'is', null),
    supabase.from('alumni').select('id, currently_at, created_at')
      .is('organization_id', null).not('currently_at', 'is', null),
  ]);

  const opts = (optRes.data as (PendingOption & OptionRow)[]) ?? [];
  const approved: Record<string, string[]> = {};
  // An alias is not a choice - it points at the name that is.
  for (const o of opts.filter((o) => o.status === 'approved' && !o.canonical_value)) {
    (approved[o.category] ??= []).push(o.value);
  }

  const pending = (reg.data as AlumniRow[]) ?? [];
  const pendingEdits = (edits.data as AlumniRow[]) ?? [];
  const { studies, work } = await loadTimelines([...pending, ...pendingEdits].map((p) => p.id));

  return {
    pending,
    pendingEdits,
    photos: ((photoRes.data as any[]) ?? []).map((r) => ({
      id: r.id, url: r.url, caption: r.caption, created_at: r.created_at,
      college: r.colleges, alumni: r.alumni,
    })),
    options: opts.filter((o) => o.status === 'pending'),
    optionRows: opts,
    approvedOptions: approved,
    unmatchedColleges: groupByTypedName((colRes.data as any[]) ?? [], 'college_name_raw'),
    unmatchedCompanies: groupByTypedName((orgRes.data as any[]) ?? [], 'currently_at'),
    higherStudies: studies,
    workExperience: work,
    error: reg.error?.message ?? edits.error?.message ?? '',
  };
}

/** Study and work rows for a set of people, grouped by person. */
export async function loadTimelines(ids: string[]): Promise<{
  studies: Record<string, HigherStudyRow[]>;
  work: Record<string, WorkExperienceRow[]>;
}> {
  const studies: Record<string, HigherStudyRow[]> = {};
  const work: Record<string, WorkExperienceRow[]> = {};
  if (ids.length === 0) return { studies, work };

  const [hs, we] = await Promise.all([
    supabase.from('higher_studies').select('*').in('alumni_id', ids),
    supabase.from('work_experience').select('*').in('alumni_id', ids),
  ]);
  for (const r of (hs.data as HigherStudyRow[]) ?? []) (studies[r.alumni_id] ??= []).push(r);
  for (const r of (we.data as WorkExperienceRow[]) ?? []) (work[r.alumni_id] ??= []).push(r);
  return { studies, work };
}

export type PeopleData = { rows: AlumniRow[]; total: number; truncated: boolean; error: string };

/**
 * Everyone already decided on.
 *
 * Searched and paged in the database rather than in the browser: the old list
 * pulled every column of every profile and filtered with includes(). The escape
 * matters - `or()` is comma-delimited, so a comma or a % in the box would
 * change what the filter means.
 */
export async function loadPeople(query: string, page: number): Promise<PeopleData> {
  const from = page * PAGE;
  let q = supabase.from('alumni')
    .select('*', { count: 'exact' })
    .neq('approval_status', 'pending')
    .order('full_name')
    .range(from, from + PAGE - 1);

  const term = query.replace(/[%_,().]/g, ' ').trim();
  if (term) {
    q = q.or([
      `full_name.ilike.%${term}%`,
      `personal_email.ilike.%${term}%`,
      `phone_number.ilike.%${term}%`,
      `college_name_raw.ilike.%${term}%`,
      `currently_at.ilike.%${term}%`,
    ].join(','));
  }

  const { data, count, error } = await q;
  const rows = (data as AlumniRow[]) ?? [];
  return {
    rows,
    total: count ?? rows.length,
    truncated: (count ?? 0) > from + rows.length,
    error: error?.message ?? '',
  };
}

export type ValueBenchData = {
  approvedOptions: Record<string, string[]>;
  optionRows: OptionRow[];
  people: { id: string }[];
  error: string;
};

/**
 * What the merge tool needs: the option lists, and every profile's six option
 * columns so it can say how many people are on each spelling.
 *
 * Six columns rather than select('*'): counting how many profiles say "BTech"
 * does not need anybody's phone number.
 */
export async function loadValueBench(): Promise<ValueBenchData> {
  const [optRes, peopleRes] = await Promise.all([
    supabase.from('field_options').select('id, category, value, status, canonical_value, created_at')
      .order('created_at', { ascending: true }),
    supabase.from('alumni')
      .select('id, stream, degree, admission_route, current_status, field, professional_course'),
  ]);

  const opts = (optRes.data as OptionRow[]) ?? [];
  const approved: Record<string, string[]> = {};
  for (const o of opts.filter((o) => o.status === 'approved' && !o.canonical_value)) {
    (approved[o.category] ??= []).push(o.value);
  }
  return {
    approvedOptions: approved,
    optionRows: opts,
    people: (peopleRes.data as { id: string }[]) ?? [],
    error: optRes.error?.message ?? peopleRes.error?.message ?? '',
  };
}

export type DataAreaData = { colleges: CollegeInfoRow[]; aliases: Record<string, AliasRow[]>; error: string };
export type AliasRow = { id: string; alias: string; source: string };

/**
 * The cleanup bench: every college our alumni are actually at, with the
 * students there and the names each institute answers to.
 *
 * Driven from `alumni`, never from the 47,000-row colleges table - the same
 * reason the public pages derive their college lists that way.
 */
export async function loadDataArea(): Promise<DataAreaData> {
  const { data: linkRows, error } = await supabase
    .from('alumni')
    .select('id, full_name, class_of, school_note, college_id, approval_status')
    .not('college_id', 'is', null);

  const byCollege = new Map<string, CollegeInfoRow['students']>();
  for (const r of (linkRows ?? []) as any[]) {
    if (r.approval_status !== 'approved') continue;
    const list = byCollege.get(r.college_id) ?? [];
    list.push({ id: r.id, full_name: r.full_name, class_of: r.class_of, school_note: r.school_note });
    byCollege.set(r.college_id, list);
  }
  if (byCollege.size === 0) return { colleges: [], aliases: {}, error: error?.message ?? '' };

  const ids = [...byCollege.keys()];
  // One query for every card's aliases, not one per card.
  const [collegeRes, aliasRes] = await Promise.all([
    supabase.from('colleges')
      .select('id, name, state, district, banner_url, logo_url, description')
      .in('id', ids).order('name'),
    supabase.from('institute_aliases')
      .select('id, alias, source, college_id').in('college_id', ids).order('alias'),
  ]);

  const aliases: Record<string, AliasRow[]> = {};
  for (const a of ((aliasRes.data ?? []) as any[])) {
    (aliases[a.college_id] ??= []).push({ id: a.id, alias: a.alias, source: a.source });
  }

  return {
    colleges: ((collegeRes.data ?? []) as any[]).map((c) => ({
      ...c,
      students: (byCollege.get(c.id) ?? []).sort((a, b) => (b.class_of ?? 0) - (a.class_of ?? 0)),
    })),
    aliases,
    error: error?.message ?? collegeRes.error?.message ?? '',
  };
}
