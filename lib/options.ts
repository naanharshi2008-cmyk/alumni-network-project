// Single source of truth for every dropdown / chip option list on the site.
//
// Before this file, register/page.tsx, profile/page.tsx and admin/page.tsx each
// carried their own copies. They had drifted: the profile page was missing
// "Higher Studies", used 'Business & Finance' where admin used
// 'Commerce (Business & Finance)', and no list included TNEA - the main
// engineering admission route in Tamil Nadu.
//
// HOW "OTHER" WORKS
// Each list ends with OTHER_OPTION. When a student picks it and types their own
// value, that value is saved on their profile straight away, and is separately
// queued in `field_options` (status='pending') for an admin to dedupe, spell
// check and approve. Only approved options ever join these lists - see
// mergeOptions() below and the "Pending Options" tab in the admin dashboard.

export const OTHER_OPTION = 'Other';

/** The three official school names, exactly as they should be displayed. */
export const SCHOOLS = [
  'Veveaham Matric Higher Secondary School (Boys)',
  'Veveaham Higher Secondary School (Girls)',
  'Veveaham Prime Academy',
] as const;

/** Legacy values that appear in older rows, mapped to the official names. */
export const LEGACY_SCHOOL_MAP: Record<string, string> = {
  'veveaham hr. sec. school': 'Veveaham Higher Secondary School (Girls)',
  'veveaham hr sec school': 'Veveaham Higher Secondary School (Girls)',
  'veveaham group of schools': 'Veveaham Higher Secondary School (Girls)',
  'veveaham prime academy': 'Veveaham Prime Academy',
};

/** Normalise any stored school value to an official name for display. */
export function officialSchoolName(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  if ((SCHOOLS as readonly string[]).includes(raw)) return raw;
  return LEGACY_SCHOOL_MAP[raw.toLowerCase()] ?? raw;
}

/** Stream studied at school (classes 11-12). */
export const STREAMS = [
  'Bio-Maths',
  'Computer Science (Maths)',
  'Pure Science (Bio)',
  'Commerce',
  'Commerce with Computer Science',
  'Arts / Humanities',
  'Vocational',
  OTHER_OPTION,
];

/** Older stored stream values, mapped onto the current list. */
export const LEGACY_STREAM_MAP: Record<string, string> = {
  'cs-maths': 'Computer Science (Maths)',
  'commerce (business & finance)': 'Commerce',
  'business & finance': 'Commerce',
};

/** Degrees pursued after school. */
export const DEGREES = [
  // Engineering & architecture
  'BE', 'BTech', 'BArch', 'BDes',
  // Medicine & allied health
  'MBBS', 'BDS', 'BAMS', 'BHMS', 'BSMS', 'BNYS', 'BPharm', 'PharmD',
  'BSc Nursing', 'BPT', 'BVSc',
  // Science & computing
  'BSc', 'Integrated MSc', 'BCA',
  // Commerce & management
  'BCom', 'BBA', 'CA', 'CS', 'CMA',
  // Arts, law, education & other
  'BA', 'BSW', 'BEd', 'LLB', 'BA LLB', 'BBA LLB', 'BHM', 'BVoc', 'Diploma',
  OTHER_OPTION,
];

/**
 * How the alumnus got their seat. TNEA (Tamil Nadu Engineering Admissions) was
 * missing entirely, despite being the single most common route for a Tamil
 * Nadu school - students had to pick "Other" and type it by hand.
 */
export const ADMISSION_ROUTES = [
  'JEE Main', 'JEE Advanced', 'TNEA', 'NEET', 'NEET (AYUSH)', 'CUET',
  'BITSAT', 'VITEEE', 'SRMJEEE', 'COMEDK', 'KCET', 'MHT-CET', 'KEAM', 'WBJEE',
  'CLAT', 'NATA', 'NDA', 'CA / CS / CMA Foundation',
  'Management Quota', 'Lateral Entry', 'Sports Quota', 'Merit / Direct',
  'Board Marks',
  OTHER_OPTION,
];

/** What they are doing right now. */
export const STATUSES = [
  'Studying UG',
  'Studying PG',
  'Higher Studies',
  'Higher Studies Abroad',
  'Working',
  'Entrepreneur',
  'Interning',
  'Preparing (Competitive Exams)',
  'Govt / Civil Services',
  'On Break',
  OTHER_OPTION,
];

/** Statuses that imply the person is still studying, so we ask for a finish year. */
const IN_PROGRESS_STATUSES = new Set([
  'Studying UG', 'Studying PG', 'Higher Studies', 'Higher Studies Abroad',
  'Interning', 'Preparing (Competitive Exams)',
]);

export function isInProgressStatus(status: string | null | undefined): boolean {
  const s = (status ?? '').trim();
  if (IN_PROGRESS_STATUSES.has(s)) return true;
  // Free-typed "Other" values still get the courtesy of the same heuristic.
  const l = s.toLowerCase();
  return l.includes('studying') || l.includes('higher studies') || l.includes('preparing');
}

export const SCHOOL_BOARDS = ['State Board', 'CBSE', 'ICSE', 'Matriculation', OTHER_OPTION];

export const COUNTRY_CODES = ['+91', '+1', '+44', '+61', '+971', '+65', '+49', '+33', '+81', '+86'];

/** The `category` keys used in the `field_options` table. */
export type OptionCategory = 'stream' | 'degree' | 'admission_route' | 'current_status' | 'field' | 'school_board';

/** Built-in defaults per category, for the admin "is this already known?" check. */
export const BUILT_IN_OPTIONS: Record<OptionCategory, string[]> = {
  stream: STREAMS,
  degree: DEGREES,
  admission_route: ADMISSION_ROUTES,
  current_status: STATUSES,
  school_board: SCHOOL_BOARDS,
  field: [], // filled from CATEGORIES in lib/types.ts to avoid a circular import
};

/** Friendly headings for the admin "Pending Options" tab. */
export const OPTION_CATEGORY_LABELS: Record<OptionCategory, string> = {
  stream: 'Stream at school',
  degree: 'Degree',
  admission_route: 'Admission route',
  current_status: 'Current status',
  field: 'Broad field',
  school_board: 'School board',
};

/**
 * Merge admin-approved options into a built-in list, keeping "Other" last and
 * never introducing a case-insensitive duplicate.
 */
export function mergeOptions(base: string[], approved?: string[]): string[] {
  if (!approved || approved.length === 0) return base;
  const core = base.filter((o) => o !== OTHER_OPTION);
  const seen = new Set(core.map((o) => o.toLowerCase()));
  for (const extra of approved) {
    const value = extra?.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    core.push(value);
  }
  return base.includes(OTHER_OPTION) ? [...core, OTHER_OPTION] : core;
}

/**
 * Given a stored value and the list it belongs to, decide what the form should
 * show: either the matching option, or "Other" with the value in the free-text
 * box. This is what the profile editor was missing - it rendered a bare "Other"
 * chip and silently overwrote a custom value with the literal string "Other".
 */
export function splitStoredValue(
  stored: string | null | undefined,
  options: string[],
  legacyMap?: Record<string, string>,
): { selected: string; other: string } {
  const value = (stored ?? '').trim();
  if (!value) return { selected: '', other: '' };
  const exact = options.find((o) => o.toLowerCase() === value.toLowerCase());
  if (exact) return { selected: exact, other: '' };
  const mapped = legacyMap?.[value.toLowerCase()];
  if (mapped && options.includes(mapped)) return { selected: mapped, other: '' };
  return { selected: OTHER_OPTION, other: value };
}

/** Resolve a form selection back into the single value to store. */
export function resolveValue(selected: string, other: string): string {
  return selected === OTHER_OPTION ? other.trim() : selected;
}
