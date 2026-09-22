/**
 * How someone got their seat, with no markup - so the profile page's band, its
 * path, the cards, the directory and the link previews all read one rule, and
 * lib/profilePath.ts can use it without pulling in React.
 *
 * A seat is got one of four ways (the owner's decision, Round 10):
 *
 *   Board marks      on Class 12 marks - including TNEA, which is counselling
 *                    on those marks, not an exam
 *   Entrance exam    through a named exam
 *   Management seat  shown like any other route; the site used to relabel it
 *                    "Board Marks", and no longer does
 *   Other            sports, lateral entry, anything else, in their words
 *
 * The site never says "quota". It is stripped from typed Other answers too.
 */

import { examCanonical, isTnea, normText } from './exams';
import { formatMarksBand, formatRankBand } from './text';
import type { AdmissionKind, Alumnus } from './types';

export type AdmissionShape = {
  kind: AdmissionKind | null;
  exam: string | null;
  detail: string | null;
};

type HasRoute = Pick<Alumnus, 'admission_route'>
  & Partial<Pick<Alumnus, 'admission_kind' | 'admission_exam' | 'admission_detail'>>;

/** The four ways in, in the order the form asks them. */
export const ADMISSION_KINDS: { key: AdmissionKind; label: string; hint: string }[] = [
  { key: 'board_marks', label: 'Board marks', hint: 'On your Class 12 marks - including TNEA counselling' },
  { key: 'entrance_exam', label: 'Entrance exam', hint: 'Through an exam like JEE, NEET or AMRITAEEE' },
  { key: 'management', label: 'Management seat', hint: 'A seat the college offered directly' },
  { key: 'other', label: 'Other', hint: 'Sports, lateral entry, or something else' },
];

const BOARD_MARKS_ROUTES = new Set(['board marks', 'merit / direct', 'merit/direct', 'merit', 'direct']);
const MANAGEMENT_ROUTES = new Set(['management quota', 'management seat', 'management']);

/**
 * The shape of a legacy `admission_route` value. Mirrors the SQL function
 * admission_from_route() in migration 18 - keep the two in step. Used for
 * registration drafts saved before this existed, and for the import.
 */
export function kindFromLegacyRoute(route: string | null | undefined, examAliases?: Record<string, string>): AdmissionShape {
  const r = (route ?? '').replace(/\s+/g, ' ').trim();
  const n = normText(r);
  if (!r) return { kind: null, exam: null, detail: null };
  if (BOARD_MARKS_ROUTES.has(n)) return { kind: 'board_marks', exam: null, detail: null };
  if (isTnea(n)) return { kind: 'board_marks', exam: null, detail: 'TNEA' };
  if (MANAGEMENT_ROUTES.has(n)) return { kind: 'management', exam: null, detail: null };
  const exam = examCanonical(r, examAliases);
  if (exam) return { kind: 'entrance_exam', exam, detail: null };
  return { kind: 'other', exam: null, detail: r.slice(0, 120) };
}

/**
 * How this person got in: the stored kind, or - for a row the database has
 * not seen since migration 18, or a draft - the kind their legacy route means.
 */
export function admissionOf(a: HasRoute): AdmissionShape {
  if (a.admission_kind) {
    return { kind: a.admission_kind, exam: a.admission_exam ?? null, detail: a.admission_detail ?? null };
  }
  return kindFromLegacyRoute(a.admission_route);
}

/** Typed words for Other, fit to print: "Sports Quota" reads "Sports". */
function tidyDetail(detail: string | null | undefined): string {
  return (detail ?? '').replace(/\s*\bquota\b\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The route as a label - for chips, filters, rails and link previews:
 * "Board marks", "Board marks (TNEA)", "JEE Main", "Management seat", or the
 * words someone typed for Other.
 */
export function routeLabel(a: HasRoute): string | null {
  return labelOfShape(admissionOf(a));
}

export function labelOfShape(s: AdmissionShape): string | null {
  switch (s.kind) {
    case 'board_marks': return s.detail === 'TNEA' ? 'Board marks (TNEA)' : 'Board marks';
    case 'entrance_exam': return s.exam || null;
    case 'management': return 'Management seat';
    case 'other': return tidyDetail(s.detail) || 'Other';
    default: return null;
  }
}

/**
 * The label inside a sentence: "via board marks (TNEA)", "via JEE Main",
 * "via lateral entry". Capitalised words drop to lower case; acronyms (TNEA,
 * CA) and exam names never do.
 */
export function routePhrase(a: HasRoute): string | null {
  const s = admissionOf(a);
  const label = labelOfShape(s);
  if (!label || s.kind === 'entrance_exam') return label;
  return label.replace(/\b([A-Z])([a-z]+)\b/g, (_, first: string, rest: string) => first.toLowerCase() + rest);
}

/** The route step's title, as a sentence. */
export function routeSentence(a: HasRoute): string | null {
  const s = admissionOf(a);
  switch (s.kind) {
    case 'board_marks':
      return s.detail === 'TNEA' ? 'Got in on board marks, through TNEA counselling' : 'Got in on board marks';
    case 'entrance_exam': return s.exam ? `Got in through ${s.exam}` : null;
    case 'management': return 'Got in on a management seat';
    case 'other': {
      const d = tidyDetail(s.detail);
      return d && d.toLowerCase() !== 'other' ? `Got in through ${routePhrase(a)}` : 'Got in another way';
    }
    default: return null;
  }
}

/** Did their seat come through an entrance exam? The home page counts these. */
export function isExamRoute(a: HasRoute): boolean {
  return admissionOf(a).kind === 'entrance_exam';
}

/**
 * The label a `?route=` value means. Links shared while the site said "Board
 * Marks", "TNEA", "JEE" or "Management Quota" still land on the same people.
 */
export function routeParamLabel(value: string): string {
  return labelOfShape(kindFromLegacyRoute(value)) ?? value;
}

/**
 * An exam's score, as the public sees it: the band a rank edge stands for, or
 * a percentile floor worth saying ("99+ percentile"). Null below 80th
 * percentile - a floor of 0 is not news, and saying so would only sting.
 */
export function attemptBand(t: { rank_band_edge: number | null; percentile_band_floor: number | null }): string | null {
  if (t.rank_band_edge) return formatRankBand(t.rank_band_edge);
  const p = t.percentile_band_floor;
  return p && p >= 80 ? `${p}+ percentile` : null;
}

/**
 * How they got in, as facts: the route, and the score that route makes
 * meaningful - a rank beside an exam, marks otherwise, a cutoff only beside
 * board marks (it is the TNEA cutoff). The rule that has always been here:
 * show what the route makes true, not everything the row happens to hold.
 *
 * Scores are always bands (see formatRankBand in lib/text.ts), shown small and
 * muted. `cutoff` is returned as typed.
 */
export function admissionFacts(a: Alumnus): {
  kind: AdmissionKind | null;
  route: string | null;
  /** The route inside a sentence, for "via …". */
  phrase: string | null;
  sentence: string | null;
  score: string | null;
  cutoff: string | null;
} {
  const shape = admissionOf(a);
  const onExam = shape.kind === 'entrance_exam';
  const rank = onExam ? formatRankBand(a.admission_rank) : null;
  const marks = !onExam ? formatMarksBand(a.board_marks) : null;
  return {
    kind: shape.kind,
    route: labelOfShape(shape),
    phrase: routePhrase(a),
    sentence: routeSentence(a),
    score: rank ?? (marks ? `${marks} marks` : null),
    cutoff: shape.kind === 'board_marks' ? ((a.board_cutoff ?? '').toString().trim() || null) : null,
  };
}
