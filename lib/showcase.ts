/**
 * What the home page shows, derived only from real approved profiles.
 *
 * Featured alumni: the school's starred picks always lead; the most complete
 * profiles fill the remaining places. The order rotates every few hours so the
 * page never goes stale, but it is fixed within a window, so every visitor in
 * that window sees the same people and nothing reshuffles on a reload.
 *
 * Nothing here invents content: fewer profiles means fewer cards, never
 * placeholders dressed up as people.
 */

import { instKey } from './instituteKey';
import { EXAM_ROUTES, publicRouteLabel } from './options';
import { Alumnus, HigherStudy, collegeDetailsOf, collegeKeyer, collegeNameOf } from './types';

export const ROTATION_HOURS = 3;

export function rotationWindow(now = Date.now()): number {
  return Math.floor(now / (ROTATION_HOURS * 3_600_000));
}

/** Small deterministic PRNG, so a window always produces the same order. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** How much a junior would get from opening this profile. */
export function completeness(a: Alumnus): number {
  const year = 365 * 24 * 3_600_000;
  return (
    (a.photo_url ? 4 : 0)
    + (a.message_1?.trim() ? 3 : 0)
    + (a.college_thoughts?.trim() ? 2 : 0)
    + (a.college_id ? 2 : a.college_name_raw ? 1 : 0)
    + (a.admission_route ? 1 : 0)
    + (a.degree || a.professional_course ? 1 : 0)
    + (a.currently_at || a.designation ? 1 : 0)
    + (a.linkedin_url ? 1 : 0)
    + (a.last_confirmed_at && Date.now() - Date.parse(a.last_confirmed_at) < year ? 1 : 0)
  );
}

/**
 * Everyone who could be featured, in this window's order: starred picks
 * (shuffled among themselves), then the rest by completeness band, shuffled
 * within each band so equally good profiles take turns.
 */
export function featuredLineup(alumni: Alumnus[], slot = rotationWindow()): Alumnus[] {
  const rand = seeded(slot * 2654435761);
  const picks = shuffle(alumni.filter((a) => a.featured), rand);
  const rest = alumni
    .filter((a) => !a.featured)
    .map((a) => ({ a, band: Math.floor(completeness(a) / 3), tie: rand() }))
    .sort((x, y) => y.band - x.band || x.tie - y.tie)
    .map((x) => x.a);
  return [...picks, ...rest];
}

/**
 * Photos for the hero collage. Prefers people who are not already in the
 * Featured row just below, so the page shows as many faces as it has.
 */
export function heroFaces(lineup: Alumnus[], featuredCount: number, max = 4): Alumnus[] {
  const withPhoto = lineup.filter((a) => a.photo_url);
  const shown = new Set(lineup.slice(0, featuredCount));
  const fresh = withPhoto.filter((a) => !shown.has(a));
  const repeat = withPhoto.filter((a) => shown.has(a));
  return [...fresh, ...repeat].slice(0, max);
}

export type Quote = { text: string; person: Alumnus };

/**
 * Every piece of advice worth putting on the quote card, in this window's
 * order. The hero cycles through them, so one person's words are not the face
 * of the school for three hours at a time.
 */
export function quoteCandidates(alumni: Alumnus[], slot = rotationWindow()): Quote[] {
  const rand = seeded(slot * 40503 + 7);
  return shuffle(
    alumni
      .map((a) => ({ person: a, text: tidyQuote(a.message_1) }))
      .filter((c): c is Quote => !!c.text),
    rand,
  );
}

/**
 * Short enough for a card: whole sentences up to ~160 characters, else a clean
 * cut. Also refuses what is plainly not advice - the hero is the front page of
 * the school, and a half-finished row that says "nmmmmmmmm" must never land
 * there.
 */
function tidyQuote(raw: string | null | undefined): string | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 24) return null;
  if (text.split(' ').length < 3) return null;         // a sentence, not a word
  if (/(.)\1{4,}/.test(text)) return null;             // "nmmmmmmm", "aaaaaa"
  if (!/[a-z\u0B80-\u0BFF]/i.test(text)) return null;  // some actual letters
  if (text.length <= 160) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  let out = '';
  for (const s of sentences) {
    if ((out + s).trim().length > 160) break;
    out += s;
  }
  if (out.trim().length >= 40) return out.trim();
  const cut = text.slice(0, 150);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/**
 * A card-sized name. Trailing initials are kept whole, as Tamil names are
 * written ("Elanchearan R S" -> "Elanchearan R. S."); otherwise the first name
 * and the last name's initial ("Arshia Goyal" -> "Arshia G."). Initials-first names
 * ("R. S. Kumar") are left as written.
 */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  // Initials first ("R. S. Kumar") is already short; shortening it would lose the name.
  if (parts[0].replace(/\./g, '').length === 1) return parts.join(' ');
  const rest = parts.slice(1);
  if (rest.every((p) => p.replace(/\./g, '').length === 1)) {
    return `${parts[0]} ${rest.map((p) => `${p[0].toUpperCase()}.`).join(' ')}`;
  }
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Where a profile opens. */
export function profileHref(a: Alumnus): string {
  const p = a.public_slug || a.username;
  return p ? `/directory?p=${encodeURIComponent(p)}` : '/directory';
}

/**
 * A card-sized college name: a readable alias ("IIT Madras") when the official
 * name is long ("Indian Institute of Technology Madras"), else the name.
 */
export function collegeLabel(a: Alumnus): string | null {
  const details = collegeDetailsOf(a);
  const name = collegeNameOf(a) ?? a.college_name_raw?.trim() ?? null;
  if (!name) return null;
  return shortInstituteName(name, details?.aliases ?? []);
}

/**
 * For the small hero cards: when a name has a word too long to wrap
 * ("Thiruvananthapuram"), a readable alias whose words all fit
 * ("IISER Trivandrum"). Otherwise the usual label.
 */
export function compactCollegeLabel(a: Alumnus): string | null {
  const label = collegeLabel(a);
  if (!label) return null;
  const fits = (s: string) => s.split(/\s+/).every((w) => w.length <= 13);
  if (fits(label)) return label;
  const better = (collegeDetailsOf(a)?.aliases ?? [])
    .filter((al) => al.length <= 20 && al.includes(' ') && fits(al))
    .sort((x, y) => y.length - x.length)[0];
  return better ?? label;
}

/**
 * Everywhere this person has studied, their college first, then anything they
 * added under higher studies. Someone who did a BSc here and an MSc there has
 * two names to their story, and a card that only ever shows the first is
 * quietly wrong. Deduped by key, so the same place typed twice is one entry.
 */
export function institutesFor(a: Alumnus, studies: HigherStudy[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | null | undefined) => {
    const label = (name ?? '').trim();
    const key = instKey(label);
    if (!label || key.length < 2 || seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };
  add(compactCollegeLabel(a));
  for (const s of studies) add(s.institution);
  return out;
}

export function shortInstituteName(name: string, aliases: string[]): string {
  if (name.length <= 28) return name;
  const readable = aliases
    .filter((al) => al.length >= 5 && al.length <= 28 && al.includes(' '))
    .sort((x, y) => y.length - x.length);
  return readable[0] ?? name;
}

/** "IIT Madras" -> "IIT", "Christian Medical College" -> "CMC". For banner-less tiles. */
export function instituteInitials(label: string): string {
  const words = label.split(/[\s,.-]+/).filter(Boolean);
  if (words[0] && /^[A-Z]{2,5}$/.test(words[0])) return words[0];
  const significant = words.filter((w) => !/^(of|and|the|for|at|in|&)$/i.test(w));
  return significant.slice(0, 3).map((w) => w[0].toUpperCase()).join('') || '•';
}

/** What a card says under the college: the route and the degree. */
export function pathLine(a: Alumnus): string {
  return [publicRouteLabel(a.admission_route), a.degree || a.professional_course].filter(Boolean).join(' · ');
}

/** "'23" */
export function classTag(a: Alumnus): string {
  return a.class_of ? `’${String(a.class_of).slice(-2)}` : '';
}

export type PopularSearch = { label: string; count: number };

/** Chips under the hero search: the colleges and exams our alumni actually have. */
export function popularSearches(alumni: Alumnus[], max = 5): PopularSearch[] {
  const keyOf = collegeKeyer(alumni);
  const colleges = new Map<string, PopularSearch>();
  const exams = new Map<string, number>();
  for (const a of alumni) {
    const key = keyOf(a);
    const label = collegeLabel(a);
    if (key && label) {
      const entry = colleges.get(key) ?? { label, count: 0 };
      entry.count += 1;
      colleges.set(key, entry);
    }
    if (a.admission_route && (EXAM_ROUTES as readonly string[]).includes(a.admission_route)) {
      exams.set(a.admission_route, (exams.get(a.admission_route) ?? 0) + 1);
    }
  }
  const topColleges = [...colleges.values()].sort((x, y) => y.count - x.count).slice(0, 3);
  const topExams = [...exams.entries()].map(([label, count]) => ({ label, count }))
    .sort((x, y) => y.count - x.count).slice(0, 2);
  return [...topColleges, ...topExams].sort((x, y) => y.count - x.count).slice(0, max);
}

export type HomeStatsData = { alumni: number; colleges: number; exams: number; batches: number };

export function homeStats(alumni: Alumnus[]): HomeStatsData {
  const keyOf = collegeKeyer(alumni);
  const colleges = new Set<string>();
  const exams = new Set<string>();
  const batches = new Set<number>();
  for (const a of alumni) {
    const key = keyOf(a);
    if (key) colleges.add(key);
    // Only real entrance exams: "Board Marks" is a route, not an exam.
    if (a.admission_route && (EXAM_ROUTES as readonly string[]).includes(a.admission_route)) exams.add(a.admission_route);
    if (a.class_of) batches.add(a.class_of);
  }
  return { alumni: alumni.length, colleges: colleges.size, exams: exams.size, batches: batches.size };
}
