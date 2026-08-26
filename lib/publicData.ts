// Every public (logged-out) read goes through here.
//
// The point of centralising it: the site must never again query the `alumni`
// table from the browser. That table holds personal_email / phone_number, and
// row-level security only filters rows, so `select=*` handed out contact
// details for every approved alumnus. Reads now target the `public_alumni`
// view, which simply does not contain those columns (see schema_v2.sql).

import { supabase, isSupabaseConfigured } from './supabaseClient';
import type { Alumnus, HigherStudy, WorkExperience } from './types';

/**
 * Columns pulled for the directory and home galleries. Listed explicitly rather than
 * `*` so adding a column to the view can never silently start publishing it.
 */
export const PUBLIC_ALUMNI_SELECT = [
  'id', 'full_name', 'username', 'school_name', 'class_of', 'stream', 'degree',
  'branch', 'field', 'current_status', 'currently_at', 'designation',
  'expected_finish_year', 'show_photo', 'photo_url', 'linkedin_url',
  'message_1', 'message_2', 'last_updated', 'last_confirmed_at', 'school_note', 'college_thoughts', 'professional_course', 'professional_stage', 'admission_route', 'admission_rank', 'board_marks',
  'board_cutoff', 'college_id', 'college_name_raw', 'colleges',
].join(', ');

export type PublicDataResult<T> = { data: T; error: string };

/** All approved alumni, newest batch first. */
export async function fetchApprovedAlumni(): Promise<PublicDataResult<Alumnus[]>> {
  if (!isSupabaseConfigured) return { data: [], error: '' };
  const { data, error } = await supabase
    .from('public_alumni')
    .select(PUBLIC_ALUMNI_SELECT)
    .order('class_of', { ascending: false });
  return { data: (data as unknown as Alumnus[]) ?? [], error: error?.message ?? '' };
}


/**
 * Study + work timelines for a set of alumni, grouped by alumni id.
 *
 * These rows were being collected at registration and shown to admins, but
 * never rendered publicly - the whole point of the feature is for juniors to
 * see the path, so the directory now asks for them here.
 */
export async function fetchTimelines(alumniIds: string[]): Promise<{
  studies: Record<string, HigherStudy[]>;
  work: Record<string, WorkExperience[]>;
}> {
  const empty = { studies: {}, work: {} };
  if (!isSupabaseConfigured || alumniIds.length === 0) return empty;

  const [studiesRes, workRes] = await Promise.all([
    supabase.from('higher_studies').select('*').in('alumni_id', alumniIds),
    supabase.from('work_experience').select('*').in('alumni_id', alumniIds),
  ]);

  const studies: Record<string, HigherStudy[]> = {};
  for (const row of (studiesRes.data as HigherStudy[]) ?? []) {
    (studies[row.alumni_id] ??= []).push(row);
  }
  const work: Record<string, WorkExperience[]> = {};
  for (const row of (workRes.data as WorkExperience[]) ?? []) {
    (work[row.alumni_id] ??= []).push(row);
  }
  return { studies, work };
}

/**
 * Admin-approved extra options for a dropdown category.
 * Pending submissions are invisible here by design - a value only becomes
 * selectable once staff have deduped and spell-checked it.
 */
export async function fetchApprovedOptions(): Promise<Record<string, string[]>> {
  if (!isSupabaseConfigured) return {};
  const { data } = await supabase
    .from('field_options')
    .select('category, value')
    .eq('status', 'approved');
  const grouped: Record<string, string[]> = {};
  for (const row of (data as { category: string; value: string }[]) ?? []) {
    (grouped[row.category] ??= []).push(row.value);
  }
  return grouped;
}

/** Organisation names for the "Currently at" suggestions. */
export async function fetchOrganizationNames(limit = 300): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabase
    .from('organizations')
    .select('name')
    .order('name')
    .limit(limit);
  return ((data as { name: string }[]) ?? []).map((o) => o.name);
}

/**
 * Propose a free-typed "Other" value for admin review.
 *
 * Deliberately fire-and-forget: this is a nice-to-have that must never block or
 * fail a registration. A duplicate proposal hits the unique index and is
 * silently ignored, which is the desired outcome.
 */
export async function proposeOption(category: string, value: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const clean = value?.trim();
  if (!clean) return;
  try {
    await supabase.from('field_options').insert({ category, value: clean, status: 'pending' });
  } catch {
    /* ignore - never interrupt the user's submission */
  }
}
