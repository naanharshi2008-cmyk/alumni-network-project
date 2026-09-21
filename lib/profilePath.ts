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
import { admissionFacts } from './admission';
import { officialSchoolName, boardForSchool } from './options';
import { collegeLabel } from './showcase';
import { type Alumnus, type HigherStudy, type WorkExperience, collegeDetailsOf, professionalLabel, yearRange } from './types';

export type PathStep = {
  key: string;
  kind: 'origin' | 'route' | 'college' | 'professional' | 'study' | 'work' | 'now';
  icon: string;
  title: string;
  /** A page the title links to - the college's own page, for the college step. */
  href?: string | null;
  sub?: string | null;
  /** Small, faint: years, a score band, a finish year. */
  meta?: string | null;
  /** The green "Now" pill: this is where they are today. */
  now?: boolean;
};

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

/**
 * The steps, in the order they happened.
 *
 * Studies oldest first and jobs oldest first with the current one last, so the
 * list reads top to bottom as a life does - the page's old sort was newest
 * first, which suits a CV and not a story.
 */
export function pathSteps(a: Alumnus, studiesIn: HigherStudy[] = [], workIn: WorkExperience[] = []): PathStep[] {
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

  // 2. How they got in. The route is the step; the band sits under it, small.
  if (facts.route || facts.score) {
    steps.push({
      key: 'route', kind: 'route', icon: '📝',
      title: facts.route ? `Got in through ${facts.route}` : 'How they got in',
      meta: [facts.score, facts.cutoff ? `cutoff ${facts.cutoff}` : null].filter(Boolean).join(' · ') || null,
    });
  }

  // 3. The college.
  if (college || course) {
    steps.push({
      key: 'college', kind: 'college', icon: '🎓',
      title: course && college ? `${course} at ${college}` : (college || course),
      href: a.college_id ? `/colleges/${a.college_id}` : null,
      sub: course && a.branch ? a.branch : null,
      meta: onCourse && a.expected_finish_year && a.expected_finish_year >= THIS_YEAR
        ? `Expected to finish ${a.expected_finish_year}` : null,
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
  return real.length === 1 && !!(real[0].meta || real[0].sub);
}
