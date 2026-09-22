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
import { isExamRoute, routeLabel, routePhrase } from './admission';
import { Alumnus, HigherStudy, SCHOOL_GROUP_NAME, collegeDetailsOf, collegeKeyer, collegeNameOf, professionalLabel } from './types';

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
/**
 * Does this read as something a person meant to say?
 *
 * The checks the home page's quote picker always made, pulled out so the
 * profile page can make them too: it prints the advice as its lead, at the
 * largest size on the page after the name, and a half-finished "nmmmmmm" at
 * that size is loud.
 */
export function looksLikeWords(raw: string | null | undefined): boolean {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 24) return false;
  if (text.split(' ').length < 3) return false;          // a sentence, not a word
  if (/(.)\1{4,}/.test(text)) return false;              // "nmmmmmmm", "aaaaaa"
  return /[a-z\u0B80-\u0BFF]/i.test(text);               // some actual letters
}

function tidyQuote(raw: string | null | undefined): string | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!looksLikeWords(text)) return null;
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
  return p ? `/alumni/${encodeURIComponent(p)}` : '/directory';
}

/**
 * One sentence about a person, for the places that get one sentence: the
 * search-result snippet, the link preview in a WhatsApp group, the line under
 * their name on their own page.
 *
 * Written once so those three never disagree, and so the way it degrades -
 * no college, no route, no class - is decided in one place rather than three.
 * Clipped to about 155 characters, which is what a search result shows.
 */
export function profileSummary(a: Alumnus): string {
  const college = collegeLabel(a);
  const route = routePhrase(a);
  const course = a.degree || professionalLabel(a);

  // What they did, if we know it.
  let lead = '';
  if (college) {
    lead = course ? `${course} at ${college}` : `At ${college}`;
    if (route) lead += `, through ${route}`;
  } else if (course) {
    lead = course;
    if (a.current_status) lead += `, ${a.current_status}`;
  } else if (a.current_status) {
    lead = a.current_status;
  }

  // Clip the part that varies, not the sentence: a preview ending "…Cla" has
  // lost the school's name, which is the one thing it must carry.
  if (lead.length > 82) lead = `${lead.slice(0, 79).trimEnd()}…`;

  const who = a.class_of
    ? `Class of ${a.class_of} at ${SCHOOL_GROUP_NAME}.`
    : `An alumnus of ${SCHOOL_GROUP_NAME}.`;
  // Only offer their words when there are some. This ended "See their advice
  // for juniors." whenever there was a college - so four of the first seven
  // search snippets promised advice that was not on the page.
  const words = looksLikeWords(a.message_1) ? ' In their own words.' : '';
  return lead ? `${lead}. ${who}${words}` : `${who}${words}`;
}

/**
 * The colour a person's initials sit on when there is no college to take one
 * from. Was written out twice inside the share card; the profile page now
 * needs it too, and the two must match.
 */
export const FALLBACK_TINT = 'linear-gradient(135deg, hsl(43 66% 74%), hsl(89 64% 72%))';

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
  return institutePathsFor(a, studies).map((p) => p.label);
}

/**
 * The same places, each with the line that belongs to it.
 *
 * The hero cycled the *name* through every institute someone had studied at
 * while the line under it stayed on their undergraduate route - so a card
 * read "IIT Madras / Board Marks · BSc" for a person who did a BSc elsewhere
 * on board marks and went to IIT Madras years later. A visitor reads that
 * literally, and it is not true. A place and its line travel together now.
 *
 * Higher study carries no route, because the form never asks for one: the
 * line is the degree itself.
 */
export function institutePathsFor(
  a: Alumnus,
  studies: HigherStudy[] = [],
): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [];
  const seen = new Set<string>();
  const add = (name: string | null | undefined, path: string) => {
    const label = (name ?? '').trim();
    const key = instKey(label);
    if (!label || key.length < 2 || seen.has(key)) return;
    seen.add(key);
    out.push({ label, path });
  };
  add(compactCollegeLabel(a), pathLine(a));
  for (const s of studies) add(s.institution, (s.degree_name ?? '').trim());
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
  return [routeLabel(a), a.degree || a.professional_course].filter(Boolean).join(' · ');
}

/** "'23" */
export function classTag(a: Alumnus): string {
  return a.class_of ? `’${String(a.class_of).slice(-2)}` : '';
}

/**
 * A chip under the hero search.
 *
 * `href` rather than a label the caller turns into a search: a college we have
 * a row for has a page of its own, with a banner, the seniors there and their
 * photos, and sending someone to a search for its name instead was throwing
 * that away. The key was already being computed here and discarded.
 */
export type PopularSearch = { label: string; count: number; href: string };

/** Chips under the hero search: the colleges and exams our alumni actually have. */
export function popularSearches(alumni: Alumnus[], max = 5): PopularSearch[] {
  const keyOf = collegeKeyer(alumni);
  const colleges = new Map<string, PopularSearch>();
  const exams = new Map<string, number>();
  for (const a of alumni) {
    const key = keyOf(a);
    const label = collegeLabel(a);
    if (key && label) {
      const entry = colleges.get(key) ?? {
        label,
        count: 0,
        href: key.startsWith('id:')
          ? `/colleges/${key.slice(3)}`
          : `/directory?q=${encodeURIComponent(label)}`,
      };
      entry.count += 1;
      colleges.set(key, entry);
    }
    const exam = isExamRoute(a) ? routeLabel(a) : null;
    if (exam) exams.set(exam, (exams.get(exam) ?? 0) + 1);
  }
  const topColleges = [...colleges.values()].sort((x, y) => y.count - x.count).slice(0, 3);
  const topExams = [...exams.entries()]
    .map(([label, count]) => ({ label, count, href: `/directory?route=${encodeURIComponent(label)}` }))
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
    const exam = isExamRoute(a) ? routeLabel(a) : null;
    if (exam) exams.add(exam);
    if (a.class_of) batches.add(a.class_of);
  }
  return { alumni: alumni.length, colleges: colleges.size, exams: exams.size, batches: batches.size };
}

/**
 * A colour of its own for a college with no picture yet.
 *
 * Every initials tile on the site was painted with the one site-wide gradient,
 * so IISER Thiruvananthapuram and St Joseph's looked identical and the tile
 * read as "unfinished" rather than as an identity. The hue comes from the
 * college's own key, so it is stable, and two colleges are only the same
 * colour by coincidence.
 *
 * Lightness and saturation are pinned, and deliberately not derived: every
 * initials rule paints near-black ink on top, so a dark tint would erase the
 * letters. These two stops clear 4.5:1 against that ink at every hue, with
 * the worst case around cyan, where the eye reads a tint as much lighter than
 * the contrast maths does - `npm run check:contrast` sweeps all 360 hues and
 * both stops, and fails if a change here stops being readable.
 *
 * Key it on the group key from collegeKeyer (`id:<uuid>` or `name:<key>`),
 * never on the display name: a rename should not repaint the tile, and a
 * typed spelling should match the college it was folded into.
 */
export function instituteTint(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  return `linear-gradient(135deg, hsl(${hue} 66% 74%), hsl(${(hue + 46) % 360} 64% 72%))`;
}

/**
 * The key one alumnus's college is tinted by.
 *
 * Same shape as collegeKeyer's, but derivable from a single profile: a card
 * does not have the whole directory to fold typed spellings with. Linked
 * profiles - which is what a college with a banner or a page always is - land
 * on the same `id:` key either way.
 */
export function collegeTintKey(a: Alumnus): string | null {
  if (a.college_id) return `id:${a.college_id}`;
  // collegeNameOf only answers for a LINKED college, so a profile carrying a
  // typed name and no link used to get no tint at all on its card while
  // getting one in the College grouping, which keys off the group instead.
  const typed = collegeNameOf(a) ?? a.college_name_raw?.trim();
  return typed ? `name:${instKey(typed)}` : null;
}
