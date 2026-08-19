// Broad academic areas ("category / area" in the brief). Each alumnus is
// bucketed into one of these so the directory can filter with a single tap.

export type CategoryKey =
  | 'medicine'
  | 'engineering'
  | 'sciences'
  | 'humanities'
  | 'commerce'
  | 'law'
  | 'architecture'
  | 'nursing'
  | 'pharmacy'
  | 'agriculture'
  | 'management'
  | 'design'
  | 'computer_applications'
  | 'education'
  | 'defence'
  | 'other';

export interface Category {
  key: CategoryKey;
  /** Stored in the DB `field` column and shown on the chip. */
  label: string;
  emoji: string;
  /** Accent colour; set as `--cat` on an element and referenced in CSS. */
  accent: string;
  /** Legacy / synonym field values that also map to this category. */
  aliases: string[];
}

// Order here == order the chips render in. `label` is what gets stored in the
// DB `field` column, so these strings double as the registration form's
// "Broad area" options.
export const CATEGORIES: Category[] = [
  { key: 'engineering',           label: 'Engineering',            emoji: '⚙️', accent: '#2563eb', aliases: ['engineering', 'engineer', 'tech', 'technology', 'it'] },
  { key: 'medicine',              label: 'Medicine',               emoji: '🩺', accent: '#e11d48', aliases: ['medicine', 'medical', 'mbbs', 'dental', 'dentistry', 'bds', 'siddha', 'ayurveda', 'homeopathy'] },
  { key: 'nursing',               label: 'Nursing & Allied Health', emoji: '🧑‍⚕️', accent: '#f43f5e', aliases: ['nursing', 'allied health', 'physiotherapy', 'paramedical'] },
  { key: 'pharmacy',              label: 'Pharmacy',               emoji: '💊', accent: '#be123c', aliases: ['pharmacy', 'pharm', 'pharmaceutical'] },
  { key: 'sciences',              label: 'Sciences',               emoji: '🔬', accent: '#7c3aed', aliases: ['science', 'sciences', 'research', 'physics', 'chemistry', 'biology', 'mathematics'] },
  { key: 'agriculture',           label: 'Agriculture',            emoji: '🌾', accent: '#65a30d', aliases: ['agriculture', 'agri', 'horticulture', 'veterinary'] },
  { key: 'commerce',              label: 'Commerce & Finance',     emoji: '💼', accent: '#059669', aliases: ['commerce', 'finance', 'accounting', 'economics', 'banking'] },
  { key: 'management',            label: 'Management',             emoji: '📊', accent: '#0891b2', aliases: ['management', 'business administration', 'mba', 'bba'] },
  { key: 'law',                   label: 'Law',                    emoji: '⚖️', accent: '#475569', aliases: ['law', 'legal', 'llb'] },
  { key: 'architecture',          label: 'Architecture',           emoji: '📐', accent: '#0d9488', aliases: ['architecture', 'planning'] },
  { key: 'design',                label: 'Design',                 emoji: '🎨', accent: '#db2777', aliases: ['design', 'fashion', 'animation'] },
  { key: 'computer_applications', label: 'Computer Applications',  emoji: '💻', accent: '#4f46e5', aliases: ['computer application', 'computer applications', 'bca', 'mca', 'software'] },
  { key: 'humanities',            label: 'Humanities & Arts',      emoji: '🎭', accent: '#d97706', aliases: ['arts', 'humanities', 'media', 'literature', 'history', 'journalism', 'psychology'] },
  { key: 'education',             label: 'Education',              emoji: '📚', accent: '#ca8a04', aliases: ['education', 'teaching', 'bed'] },
  { key: 'defence',               label: 'Defence & Services',     emoji: '🎖️', accent: '#57534e', aliases: ['defence', 'defense', 'military', 'army', 'navy', 'air force', 'civil services'] },
  { key: 'other',                 label: 'Other',                  emoji: '✨', accent: '#64748b', aliases: [] },
];

const CATEGORY_BY_KEY: Record<CategoryKey, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c])
) as Record<CategoryKey, Category>;

/**
 * Map a free-text `field` value onto a broad category. Never throws.
 *
 * Matching is deliberately staged rather than a plain `includes()` sweep: a
 * bare substring test meant short aliases swallowed unrelated fields - "it"
 * matched "arch-IT-ecture", so every architect was filed under Engineering.
 * We now try an exact label/key hit first, then whole-word alias matches.
 */
export function categorize(field: string | null | undefined): Category {
  const f = (field ?? '').trim().toLowerCase();
  if (!f) return CATEGORY_BY_KEY.other;

  // 1. Exact match on the stored label or the key.
  for (const cat of CATEGORIES) {
    if (cat.label.toLowerCase() === f || cat.key === f) return cat;
  }

  // 2. Whole-word alias match, so "it" only matches the standalone word "it".
  for (const cat of CATEGORIES) {
    if (cat.key === 'other') continue;
    for (const alias of cat.aliases) {
      if (!alias) continue;
      const pattern = new RegExp(`(^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
      if (pattern.test(f)) return cat;
    }
  }

  return CATEGORY_BY_KEY.other;
}

// The one school this alumni network belongs to.
export const SCHOOL_NAME = 'Veveaham Hr. Sec. School';

export interface CollegeDetails {
  name: string | null;
  state: string | null;
  district: string | null;
  website: string | null;
  university_name: string | null;
  management_type: string | null;
  established_year: number | null;
  is_engineering: boolean | null;
  /** Campus banner, admin-uploaded to the college-banners bucket. */
  banner_url: string | null;
  /** Admin-written paragraph about the college. */
  description: string | null;
}

/**
 * Public-facing alumnus record: one row of the `public_alumni` view.
 *
 * The view exists because row-level security filters ROWS but not COLUMNS - the
 * site used to read the `alumni` table directly, which meant anyone with the
 * public anon key could ask for personal_email / phone_number and get real
 * answers. The view exposes only what is safe to publish, so this interface
 * has no contact fields at all: they are unreachable, not merely unused.
 */
export interface Alumnus {
  id?: string;
  full_name: string;
  username: string | null;
  school_name: string | null;
  school_board: string | null;
  class_of: number | null;
  stream: string | null;
  degree: string | null;
  branch: string | null;
  field: string | null;
  current_status: string | null;
  currently_at: string | null;
  designation: string | null;
  expected_finish_year: number | null;
  show_photo: boolean | null;
  photo_url: string | null;
  linkedin_url: string | null;
  message_1: string | null;
  message_2: string | null;
  /** When the PUBLISHED content last changed. Shown subtly in the modal only. */
  last_updated: string | null;
  /** When the alumnus last attested the profile is correct. */
  last_confirmed_at: string | null;
  /** Admin-written "Note from Veveaham" about this alumnus. */
  school_note: string | null;
  /** The alumnus's own words about their college experience. */
  college_thoughts: string | null;
  admission_route: string | null;
  admission_rank: string | null;
  board_marks: string | null;
  board_cutoff: string | null;
  college_id: string | null;
  college_name_raw: string | null;
  // The view builds this as a JSON object; older code paths may still hand us
  // an array from a PostgREST embed, so both shapes are accepted.
  colleges: CollegeDetails | CollegeDetails[] | null;
}

/** One entry of an alumnus's post-graduation study timeline. */
export interface HigherStudy {
  id: string;
  alumni_id: string;
  degree_name: string;
  institution: string | null;
  start_year: number | null;
  finish_year: number | null;
}

/** One job in an alumnus's work timeline. */
export interface WorkExperience {
  id: string;
  alumni_id: string;
  company: string;
  role: string | null;
  start_year: number | null;
  end_year: number | null;
  is_current: boolean | null;
}

/** Sort a work timeline newest-first, with the current role always on top. */
export function sortWorkExperience(rows: WorkExperience[]): WorkExperience[] {
  return [...rows].sort((a, b) => {
    if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
    return (b.start_year ?? 0) - (a.start_year ?? 0);
  });
}

/** Sort a study timeline newest-first. */
export function sortHigherStudies(rows: HigherStudy[]): HigherStudy[] {
  return [...rows].sort(
    (a, b) => (b.finish_year ?? b.start_year ?? 0) - (a.finish_year ?? a.start_year ?? 0),
  );
}

/** "2021 – Present" / "2019 – 2023" / "2020" for a timeline entry. */
export function yearRange(
  start: number | null | undefined,
  end: number | null | undefined,
  isCurrent?: boolean | null,
): string {
  if (isCurrent) return start ? `${start} – Present` : 'Present';
  if (start && end) return `${start} – ${end}`;
  return String(start ?? end ?? '');
}

/** Pull the college name out of whatever shape the join returns. */
export function collegeNameOf(a: Alumnus): string | null {
  const c = a.colleges;
  if (!c) return null;
  return Array.isArray(c) ? c[0]?.name ?? null : c.name;
}

/** Pull the full college details out of whatever shape the join returns. */
export function collegeDetailsOf(a: Alumnus): CollegeDetails | null {
  const c = a.colleges;
  if (!c) return null;
  return Array.isArray(c) ? c[0] ?? null : c;
}

/** Initials for the avatar fallback. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
