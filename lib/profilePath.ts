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

/** One item in a step's short list: another exam written, an offer not taken. */
export type PathAside = { key: string; text: string; href?: string | null; meta?: string | null };

export type PathStep = {
  key: string;
  kind: 'origin' | 'gap' | 'route' | 'college' | 'professional' | 'study' | 'work' | 'now';
  icon: string;
  title: string;
  /** A page the title links to - the college's own page, for the college step. */
  href?: string | null;
  sub?: string | null;
  /** Small, faint: years, a score band, a finish year. */
  meta?: string | null;
  /** The green "Now" pill: this is where they are today. */
  now?: boolean;
  /**
   * The paths beside this one: under the route, the other exams they wrote;
   * under the college, the offers they did not take. Drawn smaller, so the
   * path pursued stands apart from the ones that were open.
   */
  aside?: { label: string; items: PathAside[] } | null;
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
function otherAttempts(a: Alumnus, attempts: PublicExamAttempt[]): PathAside[] {
  const seatExam = (a.admission_exam ?? '').toLowerCase();
  const hasSeatRow = attempts.some((t) => t.got_seat);
  const others = attempts.filter((t) => {
    if (t.got_seat) return false;
    // A lone row for the seat's own exam, not marked as the seat, is the seat.
    const same = attempts.filter((x) => x.exam.toLowerCase() === t.exam.toLowerCase()).length;
    return !(!hasSeatRow && seatExam && t.exam.toLowerCase() === seatExam && same === 1);
  });
  const years = new Set(attempts.map((t) => t.exam_year ?? 0));
  const showYear = years.size > 1;
  return [...others]
    .sort((x, y) => (x.exam_year ?? 0) - (y.exam_year ?? 0) || x.exam.localeCompare(y.exam))
    .map((t) => ({
      key: `exam:${t.id}`,
      text: showYear && t.exam_year ? `${t.exam} ${t.exam_year}` : t.exam,
      meta: [attemptBand(t), t.gave_admit ? 'got an offer' : null].filter(Boolean).join(' · ') || null,
    }));
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

  // 2. How they got in. The route is the step; the band sits under it, small,
  //    and the other exams they wrote sit beside it, smaller still.
  const seat = extras.attempts.find((t) => t.got_seat);
  const score = facts.score ?? (seat && facts.kind === 'entrance_exam' ? attemptBand(seat) : null);
  const alsoWrote = otherAttempts(a, extras.attempts);
  if (facts.route || score || alsoWrote.length) {
    steps.push({
      key: 'route', kind: 'route', icon: '📝',
      title: facts.sentence ?? (facts.route ? `Got in through ${facts.route}` : 'Exams written'),
      meta: [score, facts.cutoff ? `cutoff ${facts.cutoff}` : null].filter(Boolean).join(' · ') || null,
      aside: alsoWrote.length ? { label: facts.route ? 'Also wrote' : 'Wrote', items: alsoWrote } : null,
    });
  }

  // 3. The college, with the offers they turned down listed under it.
  const offers: PathAside[] = [...extras.admits]
    .sort((x, y) => admitText(x).localeCompare(admitText(y)))
    .map((ad) => ({
      key: `admit:${ad.id}`,
      text: admitText(ad),
      href: ad.college_id ? `/colleges/${ad.college_id}` : null,
      meta: labelOfShape({ kind: ad.route_kind, exam: ad.exam, detail: ad.route_detail }),
    }))
    .filter((o) => o.text);
  if (college || course) {
    steps.push({
      key: 'college', kind: 'college', icon: '🎓',
      title: course && college ? `${course} at ${college}` : (college || course),
      href: a.college_id ? `/colleges/${a.college_id}` : null,
      sub: course && a.branch ? a.branch : null,
      meta: onCourse && a.expected_finish_year && a.expected_finish_year >= THIS_YEAR
        ? `Expected to finish ${a.expected_finish_year}` : null,
      now: onCourse,
      aside: offers.length ? { label: 'Also offered', items: offers } : null,
    });
  } else if (offers.length) {
    steps.push({ key: 'offers', kind: 'college', icon: '🎓', title: 'Offers', aside: { label: '', items: offers } });
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
      sub: tidy(s.institution) || null,
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
  return real.length === 1 && !!(real[0].meta || real[0].sub || real[0].aside);
}
