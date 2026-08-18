// Text normalisation shared by the registration form, the profile editor and
// the admin dashboard. These three used to carry their own copies of
// toTitleCase, which drifted apart over time.

// Small words that stay lowercase in title case (unless they're the very first
// word) - e.g. "Indian Institute of Science Education and Research".
const TITLE_CASE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on',
  'or', 'the', 'to', 'with',
]);

// Acronyms that must never be title-cased into "Iit" / "Nit" / "Bhel".
const KEEP_UPPER = new Set([
  'IIT', 'NIT', 'IIIT', 'IISER', 'IISC', 'NISER', 'AIIMS', 'JIPMER', 'CMC',
  'BITS', 'VIT', 'SRM', 'PSG', 'SSN', 'NIFT', 'NID', 'IIM', 'ISRO', 'DRDO',
  'BHEL', 'ONGC', 'NTPC', 'TCS', 'HCL', 'IBM', 'SAP', 'AWS', 'MBBS', 'BDS',
  'BAMS', 'BHMS', 'BSMS', 'BNYS', 'BTech', 'BSc', 'BCom', 'BCA', 'BBA', 'BA',
  'BE', 'LLB', 'LLM', 'MS', 'MBA', 'PhD', 'MSc', 'MCom', 'MCA', 'MTech', 'UPSC',
  'GATE', 'NEET', 'JEE', 'CUET', 'CLAT', 'NATA', 'NDA', 'TNEA', 'CA', 'CS',
  'CMA', 'UG', 'PG', 'IT', 'AI', 'ML', 'CSE', 'ECE', 'EEE', 'MECH', 'CIVIL',
]);

const UPPER_BY_LOWER = new Map(Array.from(KEEP_UPPER, (w) => [w.toLowerCase(), w]));

/**
 * Title-case a free-typed value while respecting known acronyms.
 * "iiser tvm" -> "IISER Tvm", "bsms" -> "BSMS", "school of law" -> "School of Law".
 * Never throws; returns '' for empty input.
 */
export function toTitleCase(text: string): string {
  if (!text) return '';
  return text
    .split(/(\s+)/) // keep whitespace groups so spacing survives
    .map((chunk, i) => {
      if (chunk === '' || /^\s+$/.test(chunk)) return chunk;
      const lower = chunk.toLowerCase();
      if (i !== 0 && TITLE_CASE_MINOR_WORDS.has(lower)) return lower;
      const acronym = UPPER_BY_LOWER.get(lower);
      if (acronym) return acronym;
      return chunk
        .split('-') // capitalize both sides of hyphenated words, e.g. "Bio-Maths"
        .map((part) => {
          if (!part) return part;
          const known = UPPER_BY_LOWER.get(part.toLowerCase());
          if (known) return known;
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join('-');
    })
    .join('');
}

/**
 * Tidy a value a student typed into a free-text box before it is stored:
 * collapses runs of whitespace, strips wrapping punctuation, and drops
 * placeholder junk like "-" or "n/a" (which used to render as a literal dash
 * on the public profile card).
 */
export function cleanFreeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const collapsed = value.replace(/\s+/g, ' ').trim().replace(/^[.,;:\-–—]+|[.,;:\-–—]+$/g, '').trim();
  if (!collapsed) return null;
  if (/^(na|n\/a|nil|none|null|nothing|no|-{1,})$/i.test(collapsed)) return null;
  return collapsed;
}

/** cleanFreeText + toTitleCase, for names of things (colleges, employers, degrees). */
export function cleanProperNoun(value: string | null | undefined): string | null {
  const cleaned = cleanFreeText(value);
  return cleaned ? toTitleCase(cleaned) : null;
}

/** Case/spacing-insensitive comparison key, used to spot duplicate entries. */
export function normalizeKey(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
