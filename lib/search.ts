/**
 * Directory search: forgiving about how an institute is written, strict about
 * people.
 *
 * Two passes. The strict pass is what almost every search hits:
 *  - an institute matches by its name, any alias, or its initials, with spacing
 *    and punctuation ignored ("IITMadras" = "IIT Madras" = "I.I.T. Madras");
 *  - otherwise every word of the query has to start a word somewhere on the
 *    profile, so "engineering 2024" finds engineers of the class of 2024.
 *
 * Only when nothing at all matches does the typo pass run, so a correctly
 * spelled search never gets padded with near misses. Even then, names and
 * numbers are never fuzzed: "karan" must not find Kiran, and "2023" must not
 * find the class of 2024.
 */

import { damerauWithin, instKey, instNorm, instQueryAcronyms } from './instituteKey';

type Text = string | null | undefined;

export type SearchFields = {
  /** Person names: matched by word prefix only, never by a typo. */
  people: Text[];
  /** College and company names with their aliases: also matched by key and initials. */
  institutes: Text[];
  /** Everything else someone might type: degree, branch, exam, school, year. */
  other: Text[];
};

export type SearchDoc = {
  /** Every normalised word on the profile. */
  words: string[];
  /** Letter-only words a typo may land on (never people's names). */
  fuzzyWords: string[];
  /** Each field with its spaces removed, so "computerscience" still finds a match. */
  fieldKeys: string[];
  /** Institute keys, plus the initials of long institute names ("cit"). */
  instKeys: string[];
};

type Query = { key: string; tokens: string[]; acronyms: string[] };

const STOPWORDS = new Set(['of', 'and', 'the', 'for', 'at', 'in']);

// "B.Tech" -> "BTech", "M.B.B.S" -> "MBBS", so a degree is one word rather than a
// stray "b" that matches everything. Only a lone letter directly followed by a
// dot and another letter is joined; "St. Joseph" and "R. S. Kumar" are untouched.
function joinInitials(value: Text): string {
  return (value ?? '').replace(/\b([a-z])\.(?=[a-z])/gi, '$1');
}

function clean(values: Text[], join = true): string[] {
  return values.map((v) => instNorm(join ? joinInitials(v) : v)).filter(Boolean);
}

export function buildSearchDoc(fields: SearchFields): SearchDoc {
  const people = clean(fields.people, false);
  const institutes = clean(fields.institutes);
  const other = clean(fields.other);

  const words = new Set<string>();
  for (const v of [...people, ...institutes, ...other]) for (const w of v.split(' ')) words.add(w);

  const fuzzyWords = new Set<string>();
  for (const v of [...institutes, ...other]) {
    for (const w of v.split(' ')) if (w.length >= 4 && /^[a-z]+$/.test(w)) fuzzyWords.add(w);
  }

  const instKeys = new Set<string>();
  for (const v of institutes) {
    instKeys.add(v.replace(/ /g, ''));
    // Initials of a long name, so "CIT" finds Coimbatore Institute of Technology
    // without anyone having to add that alias. Safe here, unlike on all 47k
    // colleges, because the directory only holds our alumni's institutes.
    const significant = v.split(' ').filter((w) => !STOPWORDS.has(w) && /^[a-z]/.test(w));
    if (significant.length >= 3) instKeys.add(significant.map((w) => w[0]).join(''));
  }

  return {
    words: [...words],
    fuzzyWords: [...fuzzyWords],
    fieldKeys: [...people, ...institutes, ...other].map((v) => v.replace(/ /g, '')),
    instKeys: [...instKeys].filter(Boolean),
  };
}

function parseQuery(raw: string): Query | null {
  const norm = instNorm(joinInitials(raw.slice(0, 100)));
  if (!norm) return null;
  return {
    key: instKey(norm),
    tokens: [...new Set(norm.split(' '))],
    acronyms: instQueryAcronyms(norm),
  };
}

function instituteMatch(doc: SearchDoc, q: Query): boolean {
  const k = q.key;
  if (k.length < 2) return false;
  return doc.instKeys.some((ik) =>
    ik === k
    || (k.length >= 3 && ik.startsWith(k))
    || (k.length >= 4 && ik.includes(k))
    || q.acronyms.includes(ik));
}

function tokenStrict(doc: SearchDoc, t: string): boolean {
  if (doc.words.some((w) => w.startsWith(t))) return true;
  return t.length >= 4 && doc.fieldKeys.some((k) => k.includes(t));
}

function tokenFuzzy(doc: SearchDoc, t: string): boolean {
  if (t.length < 5 || !/^[a-z]+$/.test(t)) return false;
  const budget = t.length >= 9 ? 2 : 1;
  return doc.fuzzyWords.some((w) => damerauWithin(t, w, budget));
}

function strictMatch(doc: SearchDoc, q: Query): boolean {
  if (instituteMatch(doc, q)) return true;
  if (q.key.length >= 4 && doc.fieldKeys.some((k) => k.includes(q.key))) return true;
  return q.tokens.every((t) => tokenStrict(doc, t));
}

function fuzzyMatch(doc: SearchDoc, q: Query): boolean {
  // The whole query as one institute with a slip in it: "IITMadrs".
  if (q.key.length >= 5 && /^[a-z]+$/.test(q.key)) {
    const budget = q.key.length >= 9 ? 2 : 1;
    if (doc.instKeys.some((ik) => damerauWithin(q.key, ik, budget))) return true;
  }
  return q.tokens.every((t) => tokenStrict(doc, t) || tokenFuzzy(doc, t));
}

/**
 * Filter items by a free-text query. `closeMatches` is true when nothing matched
 * as typed and the results come from the typo pass, so the page can say so.
 */
export function searchItems<T>(
  items: T[],
  docOf: (item: T) => SearchDoc,
  raw: string,
): { results: T[]; closeMatches: boolean } {
  const q = parseQuery(raw);
  if (!q) return { results: items, closeMatches: false };

  const strict = items.filter((item) => strictMatch(docOf(item), q));
  if (strict.length > 0) return { results: strict, closeMatches: false };

  const close = items.filter((item) => fuzzyMatch(docOf(item), q));
  return { results: close, closeMatches: close.length > 0 };
}
