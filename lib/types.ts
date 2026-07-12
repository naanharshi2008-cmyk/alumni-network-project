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

// Order here == order the chips render in.
export const CATEGORIES: Category[] = [
  { key: 'engineering',  label: 'Engineering',   emoji: '⚙️', accent: '#2563eb', aliases: ['engineering', 'tech', 'it'] },
  { key: 'medicine',     label: 'Medicine',      emoji: '🩺', accent: '#e11d48', aliases: ['medicine', 'medical', 'mbbs', 'allied health science', 'nursing', 'dental', 'pharmacy'] },
  { key: 'sciences',     label: 'Sciences',      emoji: '🔬', accent: '#7c3aed', aliases: ['science', 'sciences', 'research', 'agriculture', 'bsc'] },
  { key: 'humanities',   label: 'Humanities & Arts', emoji: '🎭', accent: '#d97706', aliases: ['arts', 'humanities', 'design', 'media', 'literature'] },
  { key: 'commerce',     label: 'Commerce',      emoji: '💼', accent: '#059669', aliases: ['commerce', 'business', 'finance', 'management', 'ca', 'economics'] },
  { key: 'law',          label: 'Law',           emoji: '⚖️', accent: '#475569', aliases: ['law', 'legal'] },
  { key: 'architecture', label: 'Architecture',  emoji: '📐', accent: '#0d9488', aliases: ['architecture', 'planning'] },
  { key: 'other',        label: 'Other',         emoji: '✨', accent: '#64748b', aliases: ['other', ''] },
];

const CATEGORY_BY_KEY: Record<CategoryKey, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c])
) as Record<CategoryKey, Category>;

/** Map a free-text `field` value onto a broad category. Never throws. */
export function categorize(field: string | null | undefined): Category {
  const f = (field ?? '').trim().toLowerCase();
  if (f) {
    for (const cat of CATEGORIES) {
      if (cat.key === 'other') continue;
      if (cat.aliases.some((a) => a && f.includes(a))) return cat;
    }
  }
  return CATEGORY_BY_KEY.other;
}

// The one school this alumni network belongs to.
export const SCHOOL_NAME = 'Veveaham Hr. Sec. School';

/** Public-facing alumnus record. Never includes email / phone. */
export interface Alumnus {
  full_name: string;
  class_of: number | null;
  stream: string | null;
  degree: string | null;
  branch: string | null;
  field: string | null;
  current_status: string | null;
  currently_at: string | null;
  designation: string | null;
  show_photo: boolean | null;
  photo_url: string | null;
  linkedin_url: string | null;
  message_1: string | null;
  message_2: string | null;
  // Supabase returns the joined row as an object (or array); we normalise it.
  colleges: { name: string | null } | { name: string | null }[] | null;
}

/** Pull the college name out of whatever shape the join returns. */
export function collegeNameOf(a: Alumnus): string | null {
  const c = a.colleges;
  if (!c) return null;
  return Array.isArray(c) ? c[0]?.name ?? null : c.name;
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
