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
/**
 * Recase a single word, honouring the known-acronym list even when the word is
 * wrapped in punctuation.
 *
 * The naive version looked the whole word up in UPPER_BY_LOWER and, on a miss,
 * fell through to "capitalise first letter, lowercase the rest". That destroyed
 * bracketed acronyms: "IIT (ISM) Dhanbad" came back as "IIT (ism) Dhanbad",
 * because "(ism)" is not a key. Names are saved through this function and the
 * admin "correct & link for all" flow then writes the mangled name onto every
 * student linked to that college, so the corruption spreads.
 *
 * Splitting the leading/trailing punctuation off first means the acronym is
 * matched on its own, then reassembled with its brackets intact.
 */
function recaseWord(part: string): string {
  const m = part.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
  if (!m) return part;
  const [, lead, core, trail] = m;
  if (!core) return part;
  const known = UPPER_BY_LOWER.get(core.toLowerCase());
  if (known) return lead + known + trail;
  // A short word the author typed in full caps is almost certainly an acronym
  // we simply haven't listed - "ISM", "NITK", "SASTRA". Lowercasing it would be
  // wrong, so leave it alone. Length-capped so a shouted word like
  // "THIRUVANANTHAPURAM" is still title-cased.
  if (core.length <= 6 && core === core.toUpperCase() && /[A-Z]/.test(core)) {
    return lead + core + trail;
  }
  return lead + core.charAt(0).toUpperCase() + core.slice(1).toLowerCase() + trail;
}

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
          return recaseWord(part);
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
