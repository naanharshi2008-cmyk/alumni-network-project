/**
 * A person's path, as data: where they started, how they got in, where they
 * went, and where they are now.
 *
 * The profile page used to say this in four separate sections - "How they got
 * in", "Where they studied", "Their journey since", "Right now" - each with its
 * own heading over one or two lines, several of which rendered over nothing.
 * Here it is one ordered list of steps, each present only when it has
 * something to say, so the page can draw a single timeline.
 *
 * Kept out of lib/profileParts.tsx, and free of JSX, so the rules about what
 * counts as "now" can be read - and checked - on their own.
 */

import { instKey } from './instituteKey';
import { admissionFacts, attemptBand, labelOfShape } from './admission';
import { officialSchoolName, boardForSchool } from './options';
import { collegeLabel, shortInstituteName } from './showcase';
import {
  type Alumnus, type HigherStudy, type PathExtras, type PublicAdmit, type PublicExamAttempt, type WorkExperience,
  collegeDetailsOf, professionalLabel, yearRange,
} from './types';

export type PathStep = {
  key: string;
  kind: 'origin' | 'gap' | 'braid' | 'college' | 'professional' | 'study' | 'work' | 'now';
  icon: string;
  title: string;
  /** A page the title links to - the college's own page, for the college step. */
  href?: string | null;
  sub?: string | null;
  /**
   * A page the SUB links to - a higher-studies institute, which is where the
   * college lives on that step rather than in the title. Every college named
   * anywhere on this page leads somewhere.
   */
  subHref?: string | null;
  /** Small, faint: years, a score band, a finish year. */
  meta?: string | null;
  /** The green "Now" pill: this is where they are today. */
  now?: boolean;
};

/* ─────────────────────────────────────────────────────────────────────────
   The braid: every way in that was open, side by side
──────────────────────────────────────────────────────────────────────────

   Until Round 11 the other exams and the offers not taken were an `aside` -
   a smaller, fainter list tucked inside the step they hung off, which read as
   a footnote to the path taken. But "I wrote five exams, three gave me an
   offer, I took this one" IS the path, and the exams that led nowhere are
   exactly what a junior is trying to learn from.

   So the middle of the timeline - how they got in, and what it got them -
   becomes a set of columns that all start level: the route taken first, then
   every other route that was open, each carrying what it produced and each
   visibly stopping where it stopped. Only the taken column carries on into the
   rest of the timeline.
*/

export type BraidOutcome = {
  key: string;
  /** "BE CSE at PSG Tech". */
  text: string;
  href?: string | null;
  meta?: string | null;
  /** false: an offer they did not take. */
  taken: boolean;
  now?: boolean;
};

export type BraidColumn = {
  key: string;
  kind: 'taken' | 'other';
  /** The way in: an exam's name, "Board marks (TNEA)", "Direct admission". */
  label: string;
  /** A score band, a cutoff - under the label, small. */
  meta?: string | null;
  outcomes: BraidOutcome[];
  /** The taken column's rail runs on into the steps below. */
  continues: boolean;
  /** Where this thread stopped: "offer not taken", "wrote it". */
  ended?: string | null;
};

const NO_EXTRAS: PathExtras = { attempts: [], admits: [], gapYears: [] };

const THIS_YEAR = new Date().getFullYear();

/** Statuses that mean "still on the course described above". */
const ON_COURSE = new Set(['Studying UG', 'Studying (CA / CS / CMA)']);

/**
 * Trailing symbols someone typed by accident - "Research Scholar~" - are not
 * part of what they meant, and the "now" line is prominent enough to show it.
 */
function tidy(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().replace(/[^\p{L}\p{N}.)]+$/u, '');
}

/** Do these two name the same place? Also true for a short form of the other. */
function samePlace(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = instKey(a);
  const y = instKey(b);
  if (x.length < 3 || y.length < 3) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/** Every name the person's college goes by: the official one and its aliases. */
function collegeNames(a: Alumnus): string[] {
  const det = collegeDetailsOf(a);
  return [det?.name, a.college_name_raw, ...(det?.aliases ?? [])].filter(Boolean) as string[];
}

/**
 * Are they still on their first course?
 *
 * The status label alone cannot be trusted for this: of the seven live
 * profiles, two in the Class of 2026 chose "Higher Studies" for the BS-MS they
 * are halfway through. An expected finish year that has not arrived yet is the
 * stronger signal, and it wins.
 */
export function stillOnCourse(a: Alumnus): boolean {
  const finish = a.expected_finish_year ?? null;
  if (finish && finish >= THIS_YEAR) return true;
  return ON_COURSE.has((a.current_status ?? '').trim());
}

/**
 * What they are doing now, when it is something the page's headline does not
 * already say. Null when "now" is simply the college in the headline - which
 * is true of every current student, and is what used to render as a whole
 * section reading "Status: Alumnus".
 */
export function nowOf(a: Alumnus, studies: HigherStudy[] = [], work: WorkExperience[] = []): string | null {
  if (stillOnCourse(a)) return null;

  const job = work.find((w) => w.is_current);
  if (job) return [tidy(job.role), tidy(job.company)].filter(Boolean).join(' at ');

  const study = ongoingStudy(studies);
  if (study) return [tidy(study.degree_name), tidy(study.institution)].filter(Boolean).join(' at ');

  const at = tidy(a.currently_at);
  // Somewhere that is just their college again is not news.
  if (at && !collegeNames(a).some((n) => samePlace(n, at))) {
    return [tidy(a.designation), at].filter(Boolean).join(' at ');
  }

  const status = tidy(a.current_status);
  if (status && status !== 'Other' && !ON_COURSE.has(status)) return status;
  return null;
}

function ongoingStudy(studies: HigherStudy[]): HigherStudy | undefined {
  return studies.find((s) => !s.finish_year || s.finish_year >= THIS_YEAR);
}

/** "Veveaham Matric HSS (Boys)" - the official name, short enough for a line. */
export function shortSchoolName(value: string | null | undefined): string {
  return officialSchoolName(value).replace(/Higher Secondary School/i, 'HSS');
}

/** "BTech IT at Amrita Coimbatore" - an offer, in as few words as it takes. */
function admitText(ad: PublicAdmit): string {
  const name = ad.college?.name
    ? shortInstituteName(ad.college.name, ad.college.aliases ?? [])
    : tidy(ad.college_name_raw);
  const course = [tidy(ad.degree), tidy(ad.branch)].filter(Boolean).join(' ');
  return course && name ? `${course} at ${name}` : (name || course);
}

/**
 * The other exams someone wrote, beside the one their seat came through.
 * The year is said only when the years differ - one year for everything is
 * noise, but "NEET 2024" beside "NEET 2025" is the story of a second try.
 */
function otherAttempts(a: Alumnus, attempts: PublicExamAttempt[]): PublicExamAttempt[] {
  const seatExam = (a.admission_exam ?? '').toLowerCase();
  const hasSeatRow = attempts.some((t) => t.got_seat);
  const others = attempts.filter((t) => {
    if (t.got_seat) return false;
    // A lone row for the seat's own exam, not marked as the seat, is the seat.
    const same = attempts.filter((x) => x.exam.toLowerCase() === t.exam.toLowerCase()).length;
    return !(!hasSeatRow && seatExam && t.exam.toLowerCase() === seatExam && same === 1);
  });
  return [...others].sort((x, y) => (x.exam_year ?? 0) - (y.exam_year ?? 0) || x.exam.localeCompare(y.exam));
}

const sameExam = (x: string | null | undefined, y: string | null | undefined) =>
  !!x && !!y && x.toLowerCase() === y.toLowerCase();

/**
 * Where a college name goes when you tap it.
 *
 * A matched college has a page of its own. One that was only ever typed - an
 * offer at a college nobody has pinned yet, an institute under higher studies -
 * has no page, but it should still lead somewhere: the college list, searched
 * for that name, which is alias-aware and usually finds it under its official
 * spelling. A name that leads nowhere at all is the one thing worse than a
 * name that leads somewhere approximate.
 */
export function collegeHref(id: string | null | undefined, name: string | null | undefined): string | null {
  if (id) return `/colleges/${id}`;
  const q = (name ?? '').trim();
  return q ? `/colleges?q=${encodeURIComponent(q)}` : null;
}

function admitOutcome(ad: PublicAdmit): BraidOutcome {
  return {
    key: `admit:${ad.id}`,
    text: admitText(ad),
    href: collegeHref(ad.college_id, ad.college?.name ?? ad.college_name_raw),
    taken: false,
  };
}

/**
 * The columns: the route taken first, then every other route that was open.
 *
 * An offer sits under the route it came through, because that is what
 * `admits.route_kind` and `admits.exam` record - so "AMRITAEEE → BE CSE at
 * Amrita, not taken" reads as one thread rather than as two unrelated facts at
 * opposite ends of the page. An offer whose route nobody recorded falls into a
 * single unlabelled column at the end rather than inventing a route for it.
 *
 * The seat they actually joined is NOT in here. It is a step of its own below,
 * where a degree belongs: these columns are the doors that were open, and the
 * degree is what they went on to do.
 */
export function pathBraid(a: Alumnus, extras: PathExtras = NO_EXTRAS): BraidColumn[] {
  const facts = admissionFacts(a);
  const seat = extras.attempts.find((t) => t.got_seat);
  const placed = new Set<string>();
  const columns: BraidColumn[] = [];

  // 1. The one they took. Only the way in, not where it led: the degree they
  //    actually joined is a step of its own on the timeline below, because it
  //    is a milestone in their life and not a footnote to an exam. What can
  //    sit here is an offer that came through the same route - a second chance
  //    at the same door, not taken.
  const takenOutcomes: BraidOutcome[] = [];
  for (const ad of extras.admits) {
    if (!facts.kind || ad.route_kind !== facts.kind) continue;
    if (facts.kind === 'entrance_exam' && !sameExam(ad.exam, a.admission_exam)) continue;
    placed.add(ad.id);
    takenOutcomes.push(admitOutcome(ad));
  }
  if (facts.route || takenOutcomes.length) {
    columns.push({
      key: 'taken', kind: 'taken',
      label: facts.route ?? 'How they got in',
      meta: [facts.score ?? (seat && facts.kind === 'entrance_exam' ? attemptBand(seat) : null),
             facts.cutoff ? `cutoff ${facts.cutoff}` : null].filter(Boolean).join(' · ') || null,
      outcomes: takenOutcomes,
      continues: true,
    });
  }

  // 2. Every other exam written, with whatever it produced under it.
  const attempts = otherAttempts(a, extras.attempts);
  const showYear = new Set(extras.attempts.map((t) => t.exam_year ?? 0)).size > 1;
  for (const t of attempts) {
    const from = extras.admits.filter((ad) => !placed.has(ad.id)
      && ad.route_kind === 'entrance_exam' && sameExam(ad.exam, t.exam));
    for (const ad of from) placed.add(ad.id);
    columns.push({
      key: `exam:${t.id}`, kind: 'other',
      label: showYear && t.exam_year ? `${t.exam} ${t.exam_year}` : t.exam,
      meta: attemptBand(t),
      outcomes: from.map(admitOutcome),
      continues: false,
      ended: from.length ? 'not taken' : (t.gave_admit ? 'had an offer' : 'wrote it'),
    });
  }

  // 3. Offers through a route that is not an exam they listed - a seat on
  //    board marks somewhere else, a direct admission turned down. Grouped by
  //    route so two offers on board marks are one thread, not two.
  const rest = extras.admits.filter((ad) => !placed.has(ad.id));
  const groups = new Map<string, { label: string; admits: PublicAdmit[] }>();
  for (const ad of rest) {
    const label = labelOfShape({ kind: ad.route_kind, exam: ad.exam, detail: ad.route_detail });
    const key = label ?? '';
    let g = groups.get(key);
    if (!g) { g = { label: label ?? 'Also offered', admits: [] }; groups.set(key, g); }
    g.admits.push(ad);
  }
  for (const [key, g] of groups) {
    columns.push({
      key: `route:${key || 'unknown'}`, kind: 'other',
      label: g.label,
      outcomes: g.admits.map(admitOutcome),
      continues: false,
      ended: 'not taken',
    });
  }

  return columns;
}

/**
 * The steps, in the order they happened.
 *
 * Studies oldest first and jobs oldest first with the current one last, so the
 * list reads top to bottom as a life does - the page's old sort was newest
 * first, which suits a CV and not a story.
 *
 * `extras` is everything beyond the seat joined: a year out, the other exams,
 * the offers not taken (fetchPathExtras in lib/publicData.ts).
 */
export function pathSteps(
  a: Alumnus, studiesIn: HigherStudy[] = [], workIn: WorkExperience[] = [], extras: PathExtras = NO_EXTRAS,
): PathStep[] {
  const steps: PathStep[] = [];
  const onCourse = stillOnCourse(a);
  const college = collegeLabel(a);
  const course = a.degree || '';
  const facts = admissionFacts(a);

  // 1. Where it started. Small and dashed on the page. The band above already
  //    gives the class and stream, so this adds only what it leaves out: the
  //    board the school follows.
  const school = shortSchoolName(a.school_name);
  if (school) {
    steps.push({
      key: 'origin', kind: 'origin', icon: '🏫',
      title: school,
      meta: boardForSchool(a.school_name),
    });
  }

  // 1b. A year out, before the seat. Only ever one they have moved past: while
  //     it is current the whole profile is unlisted (migration 18).
  for (const g of [...extras.gapYears].sort((x, y) => x.gap_year - y.gap_year)) {
    const at = tidy(g.coaching_org_name) || tidy(g.coaching_name_raw);
    steps.push({
      key: `gap:${g.id}`, kind: 'gap', icon: g.kind === 'preparing' ? '📚' : '🌱',
      title: g.kind === 'preparing'
        ? (g.exam ? `A year preparing for ${g.exam}` : 'A year preparing for an exam')
        : 'A year out',
      sub: g.kind === 'preparing' && at ? `with ${at}` : null,
      meta: String(g.gap_year),
    });
  }

  // 2. How they got in: every way that was open, side by side, with the offers
  //    each one produced. The data is in pathBraid() above; here it only needs
  //    a place in the order.
  const braid = pathBraid(a, extras);
  if (braid.length) steps.push({ key: 'braid', kind: 'braid', icon: '📝', title: '' });

  // 3. The degree they joined - a step of its own, not a line hanging off the
  //    exam that got them in. It is the thing most of this page is about, and
  //    it belongs on the timeline with everything else that happened.
  if (college || course) {
    steps.push({
      key: 'college', kind: 'college', icon: '🎓',
      title: course && college ? `${course} at ${college}` : (college || course),
      href: collegeHref(a.college_id, college ?? a.college_name_raw),
      sub: course && a.branch ? a.branch : null,
      meta: a.expected_finish_year
        ? `${onCourse ? 'Expected to finish' : 'Finished'} ${a.expected_finish_year}` : null,
      now: onCourse,
    });
  }

  // 4. A professional qualification, alongside a degree or instead of one.
  const prof = professionalLabel(a);
  if (prof) {
    steps.push({
      key: 'professional', kind: 'professional', icon: '📜',
      title: prof,
      sub: a.professional_org ? `at ${tidy(a.professional_org)}` : null,
      now: onCourse && !college && !course,
    });
  }

  // 5. Further study, oldest first. A UG degree typed again under higher
  //    studies is the same step, not a second one.
  const studies = [...studiesIn]
    .filter((s) => !(course && samePlace(s.institution, college) && instKey(s.degree_name) === instKey(course)))
    .sort((x, y) => (x.start_year ?? x.finish_year ?? 0) - (y.start_year ?? y.finish_year ?? 0));
  const ongoing = onCourse ? undefined : ongoingStudy(studies);
  for (const s of studies) {
    steps.push({
      key: `study:${s.id}`, kind: 'study', icon: '🎓',
      title: tidy(s.degree_name),
      // The college's own short name when the row resolved to one - "IIT
      // Madras" rather than whatever was typed - and the typed text otherwise.
      sub: (s.college?.name ? shortInstituteName(s.college.name, s.college.aliases ?? []) : tidy(s.institution)) || null,
      subHref: collegeHref(s.college_id, s.college?.name ?? s.institution),
      meta: yearRange(s.start_year, s.finish_year) || null,
      now: s === ongoing,
    });
  }

  // 6. Work, oldest first, the current job last.
  const work = [...workIn].sort((x, y) => {
    if (!!x.is_current !== !!y.is_current) return x.is_current ? 1 : -1;
    return (x.start_year ?? 0) - (y.start_year ?? 0);
  });
  for (const w of work) {
    steps.push({
      key: `work:${w.id}`, kind: 'work', icon: '💼',
      title: [tidy(w.role), tidy(w.company)].filter(Boolean).join(' · '),
      meta: yearRange(w.start_year, w.end_year, w.is_current) || null,
      now: !onCourse && !!w.is_current,
    });
  }

  // 7. Now - only when nothing above already says it.
  const now = nowOf(a, studiesIn, workIn);
  if (now && !steps.some((s) => s.now)) {
    steps.push({ key: 'now', kind: 'now', icon: '📍', title: now, now: true });
  }

  return steps;
}

/**
 * Is there a path worth drawing?
 *
 * A single step that only repeats the headline ("BS-MS at IISER") is not one.
 * Two real steps are, and so is one that adds something - a finish year, a
 * score - the headline does not carry.
 */
export function pathIsWorthDrawing(steps: PathStep[]): boolean {
  const real = steps.filter((s) => s.kind !== 'origin');
  if (real.length >= 2) return true;
  // A braid is always worth drawing on its own: even one column says how they
  // got in and what it got them, which the headline never does.
  return real.length === 1 && (real[0].kind === 'braid' || !!(real[0].meta || real[0].sub));
}
