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

/* ── Admission numbers, shown as bands ──────────────────────────────────────
 *
 * The directory deliberately never prints an exact rank or percentage.
 *
 * Two reasons, and the second is the one that matters. First, exact figures
 * turn a page of classmates into a scoreboard, and the point of this site is
 * for a junior to feel a path is reachable, not to rank the seniors on it.
 * Second, and less obvious: of the 16 alumni who came in through an entrance
 * exam, 13 left the rank blank. Printing exact ranks would therefore show a
 * number on a handful of cards, self-selected towards people comfortable
 * sharing a good one - so a visitor would conclude everyone here scored
 * brilliantly. A sparse, top-heavy set of numbers is worse than none.
 *
 * A band keeps the only part a student actually needs ("roughly under 10,000
 * gets you in here") while removing person-to-person comparison. Exact values
 * stay in the database for the school.
 */

function inLakhs(n: number): string {
  return n % 100000 === 0 ? `${n / 100000} lakh` : n.toLocaleString('en-IN');
}

/** "4812" -> "Rank 1,000–5,000"; "47" -> "Top 100". Null when unusable. */
export function formatRankBand(rank: string | number | null | undefined): string | null {
  if (rank === null || rank === undefined || rank === '') return null;
  const n = typeof rank === 'number' ? rank : parseInt(String(rank).replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Returns a display-ready label, because the two shapes want different
  // wording: "Top 100" already says what it is, while a range needs "Rank"
  // in front of it or it reads as a bare pair of numbers.
  const edges = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000];
  if (n <= 100) return 'Top 100';
  if (n <= 500) return 'Top 500';
  if (n <= 1000) return 'Top 1,000';
  for (let i = 3; i < edges.length; i++) {
    if (n <= edges[i]) return `Rank ${edges[i - 1].toLocaleString('en-IN')}–${inLakhs(edges[i])}`;
  }
  return 'Rank over 1 lakh';
}

/** "92.4" -> "90–95%". Returns null when there's nothing usable. */
export function formatMarksBand(marks: string | number | null | undefined): string | null {
  if (marks === null || marks === undefined || marks === '') return null;
  const n = typeof marks === 'number' ? marks : parseFloat(String(marks).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;

  if (n >= 95) return '95%+';
  if (n >= 90) return '90–95%';
  if (n >= 85) return '85–90%';
  if (n >= 80) return '80–85%';
  const lower = Math.floor(n / 10) * 10;
  if (lower < 50) return 'Under 50%';
  return `${lower}–${lower + 10}%`;
}

/**
 * The span of ranks among a group of alumni at one college, e.g.
 * "1,240–18,900". Shown on the College Explorer because it is the single most
 * useful line on the site for a student choosing where to aim - and a WIDE
 * range is the encouraging case, since it shows the door is not only open to
 * toppers. Non-personal by construction: no rank is attributed to anyone.
 */
export function formatRankSpan(ranks: (string | number | null | undefined)[]): string | null {
  const ns = ranks
    .map((r) => (typeof r === 'number' ? r : parseInt(String(r ?? '').replace(/[^\d]/g, ''), 10)))
    .filter((n) => Number.isFinite(n) && n > 0) as number[];
  if (ns.length === 0) return null;
  const lo = Math.min(...ns);
  const hi = Math.max(...ns);
  if (lo === hi) return `around ${lo.toLocaleString('en-IN')}`;
  return `${lo.toLocaleString('en-IN')}–${hi.toLocaleString('en-IN')}`;
}


/* ── Freshness dates ─────────────────────────────────────────────────────────
 * Month-year for public surfaces (skew-tolerant, non-fussy), full date for the
 * alumnus's own page. Both swallow bad input rather than throwing.
 */

/** "2026-03-14T…" -> "Mar 2026". Null when unusable. */
export function formatMonthYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** "2026-03-14T…" -> "14 Mar 2026". Null when unusable. */
export function formatFullDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
