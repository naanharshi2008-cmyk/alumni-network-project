/**
 * Institute-name normalisers, mirroring public.inst_norm(), public.inst_key()
 * and public.inst_query_acronyms() in migrations/09_institute_keys.sql exactly.
 * The database decides what matches when someone registers; these make the
 * public directory search agree with it. Change both together.
 */

const STOPWORDS = new Set(['of', 'and', 'the', 'for', 'at', 'in']);

/** "St. Joseph's College" -> "st josephs college"; "I I T Madras" -> "iit madras". */
export function instNorm(value: string | null | undefined): string {
  if (value == null) return '';
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bgovt\b/g, 'government')
    .replace(/\bengg\b/g, 'engineering')
    .replace(/\buniv\b/g, 'university')
    .replace(/\b([a-z]) (?=[a-z]( |$))/g, '$1')
    .trim();
}

/** Spacing never matters: "IITMadras" = "IIT Madras" = "I.I.T. Madras" -> "iitmadras". */
export function instKey(value: string | null | undefined): string {
  return instNorm(value).replace(/ /g, '');
}

/** For a query of 3+ significant words: full initials, and initials + last word. */
export function instQueryAcronyms(norm: string): string[] {
  const words = norm.split(' ').filter((w) => w && !STOPWORDS.has(w));
  if (words.length < 3) return [];
  const initials = (ws: string[]) => ws.map((w) => w[0]).join('');
  return [initials(words), initials(words.slice(0, -1)) + words[words.length - 1]];
}

/**
 * True when a and b are within k edits (insert, delete, substitute, or swap two
 * neighbours). Bails out as soon as a row exceeds k, so it stays cheap.
 */
export function damerauWithin(a: string, b: string, k: number): boolean {
  if (Math.abs(a.length - b.length) > k) return false;
  if (a === b) return true;
  const n = a.length, m = b.length;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > k) return false;
    prev2 = prev;
    prev = cur;
  }
  return prev[m] <= k;
}
