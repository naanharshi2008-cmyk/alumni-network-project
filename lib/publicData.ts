// Every public (logged-out) read goes through here.
//
// The point of centralising it: the site must never again query the `alumni`
// table from the browser. That table holds personal_email / phone_number, and
// row-level security only filters rows, so `select=*` handed out contact
// details for every approved alumnus. Reads now target the `public_alumni`
// view, which simply does not contain those columns (see schema_v2.sql).

import { supabase, isSupabaseConfigured } from './supabaseClient';
import type { Alumnus, CategoryKey, HigherStudy, PathExtras, PublicAdmit, PublicExamAttempt, PublicGapYear, WorkExperience } from './types';
import { collegeDetailsOf } from './types';
import { normaliseOptionValue } from './options';
import { collegeLabel } from './showcase';
import { admissionOf, routeLabel, routePhrase } from './admission';

/**
 * Columns pulled for the directory and home galleries. Listed explicitly rather than
 * `*` so adding a column to the view can never silently start publishing it.
 */
export const PUBLIC_ALUMNI_SELECT = [
  'id', 'full_name', 'username', 'public_slug', 'school_name', 'class_of', 'stream', 'degree',
  'branch', 'field', 'current_status', 'currently_at', 'designation',
  'expected_finish_year', 'show_photo', 'photo_url', 'linkedin_url',
  'message_1', 'message_2', 'last_updated', 'last_confirmed_at', 'school_note', 'college_thoughts', 'professional_course', 'professional_stage', 'professional_org', 'admission_route', 'admission_rank', 'board_marks',
  'board_cutoff', 'college_id', 'college_name_raw', 'colleges', 'organization_id', 'organization', 'featured',
  'admission_kind', 'admission_exam', 'admission_detail', 'linkedin_handle',
].join(', ');

export type PublicDataResult<T> = { data: T; error: string; total?: number; truncated?: boolean };

/**
 * How many alumni one page will ask for.
 *
 * PostgREST caps a result server-side (db-max-rows) and says nothing about
 * it, so a bigger number here does not make the cap go away - which is why
 * the count below matters more than the limit does.
 */
export const ALUMNI_LIMIT = 2000;

/** All approved alumni, newest batch first. */
export async function fetchApprovedAlumni(): Promise<PublicDataResult<Alumnus[]>> {
  if (!isSupabaseConfigured) return { data: [], error: '', total: 0, truncated: false };
  const { data, error, count } = await supabase
    .from('public_alumni')
    .select(PUBLIC_ALUMNI_SELECT, { count: 'exact' })
    .order('class_of', { ascending: false })
    .limit(ALUMNI_LIMIT);
  const rows = (data as unknown as Alumnus[]) ?? [];
  // Asking for the count is what turns "we got 1,000 rows" into "we got 1,000
  // of 1,240" - the directory has carried a comment about this trap for the
  // colleges table since round 5, while its own alumni query had it too.
  return {
    data: rows,
    error: error?.message ?? '',
    total: count ?? rows.length,
    truncated: (count ?? 0) > rows.length,
  };
}


/**
 * Enough of a person to draw a card, and no more.
 *
 * The related-people rails on a profile page show eight names apiece; pulling
 * the full 33-column projection for each of them would cost more than the
 * page itself.
 */
export const PUBLIC_ALUMNI_CARD_SELECT = [
  'id', 'full_name', 'public_slug', 'username', 'class_of', 'stream', 'degree',
  'field', 'admission_route', 'admission_kind', 'admission_exam', 'admission_detail',
  'show_photo', 'photo_url', 'college_id', 'college_name_raw', 'colleges',
].join(', ');

/** One person, by the slug in their URL. Falls back to the old username. */
export async function fetchAlumnusBySlug(slug: string): Promise<{ person: Alumnus | null; canonical: string | null }> {
  if (!isSupabaseConfigured || !slug) return { person: null, canonical: null };

  const bySlug = await supabase
    .from('public_alumni').select(PUBLIC_ALUMNI_SELECT).eq('public_slug', slug).maybeSingle();
  if (bySlug.data) return { person: bySlug.data as unknown as Alumnus, canonical: null };

  // Links shared before slugs existed carry a username. Answer them, then say
  // where the page really lives so only one URL is ever indexed.
  const byUsername = await supabase
    .from('public_alumni').select(PUBLIC_ALUMNI_SELECT).eq('username', slug).maybeSingle();
  if (byUsername.data) {
    const person = byUsername.data as unknown as Alumnus;
    return { person, canonical: person.public_slug ?? null };
  }
  return { person: null, canonical: null };
}

export type RelatedRail = {
  title: string;
  href: string;
  people: Alumnus[];
  /** The college's mark, on the college rail - the page's one link to it. */
  logo?: string | null;
};

/**
 * Others like this person: their batch, their college, their exam.
 *
 * Three narrow reads rather than fetching the whole directory and filtering
 * in memory - a profile page should not cost what the directory costs.
 */
/**
 * Others like this person, three ways.
 *
 * In a junior's order: the same college first (the question they came with),
 * then the same way in, then the same batch - which is the order they would
 * ask it in, not the order the columns sit in. Six a rail: three rails of
 * eight was twenty-four chips in a 680px column, a wall rather than a list.
 */
export async function fetchRelatedAlumni(a: Alumnus, limit = 6): Promise<RelatedRail[]> {
  if (!isSupabaseConfigured || !a.id) return [];

  const base = () => supabase.from('public_alumni').select(PUBLIC_ALUMNI_CARD_SELECT).neq('id', a.id).limit(limit);
  const wanted: { title: string; href: string; run: any; logo?: string | null }[] = [];

  if (a.college_id) {
    wanted.push({
      title: `Others at ${collegeLabel(a) ?? 'the same college'}`,
      href: `/colleges/${a.college_id}`,
      run: base().eq('college_id', a.college_id),
      logo: collegeDetailsOf(a)?.logo_url ?? null,
    });
  }
  const how = admissionOf(a);
  const label = routeLabel(a);
  if (how.kind && label) {
    // The same way in, by kind: the same exam, board marks (through TNEA or
    // not, as they did), a management seat, or the same words for Other.
    let run = base().eq('admission_kind', how.kind);
    if (how.kind === 'entrance_exam') run = run.eq('admission_exam', how.exam);
    else if (how.detail) run = run.eq('admission_detail', how.detail);
    else if (how.kind === 'board_marks') run = run.is('admission_detail', null);
    wanted.push({
      title: `Others via ${routePhrase(a)}`,
      href: `/directory?route=${encodeURIComponent(label)}`,
      run,
    });
  }
  if (a.class_of) {
    wanted.push({
      title: `Others from the Class of ${a.class_of}`,
      href: `/directory?batch=${a.class_of}`,
      run: base().eq('class_of', a.class_of),
    });
  }

  const results = await Promise.all(wanted.map((w) => w.run));
  return wanted
    .map((w, i) => ({ title: w.title, href: w.href, logo: w.logo, people: (results[i]?.data ?? []) as Alumnus[] }))
    .filter((rail) => rail.people.length > 0);
}

/**
 * The rest of a path, for a set of people: every exam they wrote, the offers
 * they did not take, and any year out they have moved past.
 *
 * From the public views, which carry only listed people and only rank bands.
 * Paged through PostgREST's 1,000-row cap, because the directory asks for
 * everyone at once.
 */
/**
 * Rows for a set of people, whatever the size of the set.
 *
 * Chunks of ids keep each request's URL short - 2,000 uuids is a 74 KB query
 * string, which proxies drop - and pages keep each request under PostgREST's
 * silent 1,000-row cap. Both limits fail quietly, by returning less than was
 * asked for, which is the worst way for a limit to fail.
 */
const ID_CHUNK = 150;
const PAGE = 1000;
async function readAllFor<T>(view: string, ids: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const slice = ids.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(view).select('*').in('alumni_id', slice)
        .order('id').range(from, from + PAGE - 1);
      if (error || !data) break;
      rows.push(...(data as T[]));
      if (data.length < PAGE) break;
    }
  }
  return rows;
}

export async function fetchPathExtras(alumniIds: string[]): Promise<Record<string, PathExtras>> {
  const out: Record<string, PathExtras> = {};
  if (!isSupabaseConfigured || alumniIds.length === 0) return out;
  const slot = (id: string) => (out[id] ??= { attempts: [], admits: [], gapYears: [] });

  const [attempts, admits, gaps] = await Promise.all([
    readAllFor<PublicExamAttempt>('public_exam_attempts', alumniIds),
    readAllFor<PublicAdmit>('public_admits', alumniIds),
    readAllFor<PublicGapYear>('public_gap_years', alumniIds),
  ]);
  for (const r of attempts) slot(r.alumni_id).attempts.push(r);
  for (const r of admits) slot(r.alumni_id).admits.push(r);
  for (const r of gaps) slot(r.alumni_id).gapYears.push(r);
  return out;
}

/**
 * Everything the Pathways pages count: every listed person (a card's worth),
 * every exam written, every offer not taken, each exam's areas, and how many
 * are preparing again per area. Paged through PostgREST's 1,000-row cap.
 */
export async function fetchPathwaysData(): Promise<{
  alumni: Alumnus[];
  attempts: Pick<PublicExamAttempt, 'alumni_id' | 'exam' | 'gave_admit' | 'got_seat'>[];
  admits: Pick<PublicAdmit, 'alumni_id' | 'degree' | 'branch' | 'route_kind' | 'exam' | 'route_detail'>[];
  examAreas: Record<string, CategoryKey[]>;
  preparing: { area: string; preparing: number }[];
}> {
  const empty = { alumni: [], attempts: [], admits: [], examAreas: {}, preparing: [] };
  if (!isSupabaseConfigured) return empty;
  async function all<T>(view: string, select: string): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(view).select(select).order('id').range(from, from + 999);
      if (error || !data) break;
      rows.push(...(data as T[]));
      if (data.length < 1000) break;
    }
    return rows;
  }
  const [alumni, attempts, admits, options, preparing] = await Promise.all([
    all<Alumnus>('public_alumni', `${PUBLIC_ALUMNI_CARD_SELECT}, branch, professional_course`),
    all<PublicExamAttempt>('public_exam_attempts', 'id, alumni_id, exam, gave_admit, got_seat'),
    all<PublicAdmit>('public_admits', 'id, alumni_id, degree, branch, route_kind, exam, route_detail'),
    supabase.from('field_options').select('value, areas').eq('category', 'exam').eq('status', 'approved').is('canonical_value', null),
    supabase.rpc('pathway_preparing_counts'),
  ]);
  const examAreas: Record<string, CategoryKey[]> = {};
  for (const o of (options.data as { value: string; areas: CategoryKey[] | null }[]) ?? []) {
    if (o.areas?.length) examAreas[o.value] = o.areas;
  }
  return {
    alumni, attempts, admits, examAreas,
    preparing: ((preparing.data as { area: string; preparing: number }[]) ?? []),
  };
}

/** Just enough of every approved profile to build the sitemap. */
export async function fetchSitemapRows(): Promise<
  { public_slug: string | null; last_updated: string | null; last_confirmed_at: string | null; college_id: string | null }[]
> {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabase
    .from('public_alumni')
    .select('public_slug, last_updated, last_confirmed_at, college_id')
    .limit(ALUMNI_LIMIT);
  return (data ?? []) as any[];
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

  // Studies come from the public view (migration 21): the same rows anon could
  // already read, plus the college each one resolved to, embedded - so a page
  // can draw the link without a second request. Work has no view yet.
  //
  // Both are paged. This used to be one unpaged `.in()` over up to 2,000 ids,
  // which the directory hits, and it would have started losing rows silently.
  const [studiesRows, workRows] = await Promise.all([
    readAllFor<HigherStudy>('public_higher_studies', alumniIds),
    readAllFor<WorkExperience>('work_experience', alumniIds),
  ]);

  const studies: Record<string, HigherStudy[]> = {};
  for (const row of studiesRows) (studies[row.alumni_id] ??= []).push(row);
  const work: Record<string, WorkExperience[]> = {};
  for (const row of workRows) (work[row.alumni_id] ??= []).push(row);
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
    .eq('status', 'approved')
    // An old spelling the school has merged away is still readable - the forms
    // use it to map what someone types - but it is not an option any more.
    .is('canonical_value', null);
  const grouped: Record<string, string[]> = {};
  for (const row of (data as { category: string; value: string }[]) ?? []) {
    (grouped[row.category] ??= []).push(row.value);
  }
  return grouped;
}

/**
 * Old spellings, and the display name each one now means.
 *
 * Keyed by category, then by the spelling in lower case with its spacing
 * collapsed, so "IISER  Aptitude test" finds "IAT (IISER Aptitude Test)".
 * This is what stops a list splitting again the moment someone types the old
 * name under "Other".
 */
export async function fetchOptionAliases(): Promise<Record<string, Record<string, string>>> {
  if (!isSupabaseConfigured) return {};
  const { data } = await supabase
    .from('field_options')
    .select('category, value, canonical_value')
    .not('canonical_value', 'is', null);
  const map: Record<string, Record<string, string>> = {};
  for (const row of (data as { category: string; value: string; canonical_value: string }[]) ?? []) {
    (map[row.category] ??= {})[normaliseOptionValue(row.value)] = row.canonical_value;
  }
  return map;
}

export { normaliseOptionValue };

/** The display name for what someone typed, if the school has merged it away. */
export function canonicalOption(
  aliases: Record<string, Record<string, string>>,
  category: string,
  value: string | null | undefined,
): string {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return clean;
  return aliases[category]?.[normaliseOptionValue(clean)] ?? clean;
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
  // "IAT  (IISER Aptitude Test)" with two spaces became its own approved
  // option, sitting in the filter next to the single-spaced one.
  const clean = value?.replace(/\s+/g, ' ').trim();
  if (!clean) return;
  try {
    await supabase.from('field_options').insert({ category, value: clean, status: 'pending' });
  } catch {
    /* ignore - never interrupt the user's submission */
  }
}
