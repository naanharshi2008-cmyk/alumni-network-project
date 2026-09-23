/**
 * The answers the Round 10 form pieces collect, and the rows they become.
 *
 * Pure functions, no React: registration, /profile and the school's editor
 * all build the same rows from the same answers, and a scratch script can
 * check the builders without a browser. The components in this folder only
 * hold these shapes and call these functions.
 */

import { kindFromLegacyRoute } from '../admission';
import { examCanonical, isTnea, normText } from '../exams';
import type { InstitutePick } from '../institutes';
import { cleanFreeText, cleanProperNoun } from '../text';
import type { AdmissionKind } from '../types';

let seq = 0;
/** A key for a list row that has not been saved yet. */
export const newKey = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;

const digits = (v: string | null | undefined) => (v ?? '').replace(/[^\d]/g, '');
const toInt = (v: string | null | undefined): number | null => {
  const d = digits(v);
  if (!d || d.length > 9) return null;
  const n = parseInt(d, 10);
  return n > 0 ? n : null;
};

/* ─────────────────────────────────────────────────────────────────────────
   How the seat was got
───────────────────────────────────────────────────────────────────────── */
export type AdmissionDraft = {
  kind: AdmissionKind | '';
  /** The exam, for an entrance exam: canonical once picked, typed otherwise. */
  exam: string;
  /** Board marks through TNEA counselling. */
  tnea: '' | 'yes' | 'no';
  /** A few words, for Other. Never required. */
  other: string;
  rank: string;
  marks: string;
  cutoff: string;
};

export const emptyAdmission = (): AdmissionDraft => ({
  kind: '', exam: '', tnea: '', other: '', rank: '', marks: '', cutoff: '',
});

/** A saved row (or a staged edit laid over one) as the form's answers. */
export function admissionFromRow(row: {
  admission_kind?: AdmissionKind | null; admission_exam?: string | null; admission_detail?: string | null;
  admission_route?: string | null; admission_rank?: string | number | null;
  board_marks?: string | number | null; board_cutoff?: string | number | null;
}): AdmissionDraft {
  const shape = row.admission_kind
    ? { kind: row.admission_kind, exam: row.admission_exam ?? null, detail: row.admission_detail ?? null }
    : kindFromLegacyRoute(row.admission_route);
  return {
    kind: shape.kind ?? '',
    exam: shape.kind === 'entrance_exam' ? (shape.exam ?? '') : '',
    tnea: shape.kind === 'board_marks' ? (shape.detail === 'TNEA' ? 'yes' : 'no') : '',
    other: shape.kind === 'other' ? (shape.detail ?? '') : '',
    rank: row.admission_rank != null ? String(row.admission_rank) : '',
    marks: row.board_marks != null ? String(row.board_marks) : '',
    cutoff: row.board_cutoff != null ? String(row.board_cutoff) : '',
  };
}

/**
 * The columns for alumni. `admission_route` is not written: a trigger labels
 * it from the kind (migration 18), so the two can never disagree.
 *
 * Rank, marks and cutoff are all kept whatever the kind says today - nulling
 * the unused ones used to delete a rank the moment someone changed their
 * route. What is shown is decided by admissionFacts() in lib/admission.ts.
 */
export function admissionColumns(d: AdmissionDraft, examAliases?: Record<string, string>) {
  const kind = d.kind || null;
  const exam = kind === 'entrance_exam'
    ? (examCanonical(d.exam, examAliases) ?? cleanFreeText(d.exam))
    : null;
  const detail = kind === 'board_marks'
    ? (d.tnea === 'yes' ? 'TNEA' : null)
    : kind === 'other' ? cleanFreeText(d.other) : null;
  return {
    admission_kind: kind === 'entrance_exam' && !exam ? null : kind,
    admission_exam: exam,
    admission_detail: detail,
    admission_rank: digits(d.rank) || null,
    board_marks: cleanFreeText(d.marks),
    board_cutoff: cleanFreeText(d.cutoff),
  };
}

export function admissionProblem(d: AdmissionDraft, required: boolean): string {
  if (!d.kind) return required ? 'How did you get this seat?' : '';
  if (d.kind === 'entrance_exam') {
    if (!d.exam.trim()) return 'Which exam got you the seat?';
    if (isTnea(d.exam)) return 'TNEA is counselling on your marks — choose Board marks instead.';
    const r = digits(d.rank);
    if (d.rank.trim() && (!r || parseInt(r, 10) <= 0)) return 'Rank must be a positive number.';
  }
  if (d.marks.trim()) {
    const m = parseFloat(d.marks);
    if (Number.isNaN(m) || m < 0 || m > 100) return 'Marks must be between 0 and 100.';
  }
  return '';
}

/* ─────────────────────────────────────────────────────────────────────────
   Exams written
───────────────────────────────────────────────────────────────────────── */
export type AttemptDraft = {
  key: string;
  exam: string;
  /** Blank means the year they finished school. */
  year: string;
  rank: string;
  admit: '' | 'yes' | 'no';
  /**
   * Where that offer was, asked at the moment they say there was one (Round
   * 11). The route is not asked again: it is this exam, by definition. Only
   * meaningful while `admit === 'yes'`; a change of mind leaves it here
   * untouched, so ticking No and Yes again does not lose what was typed, and
   * offerDrafts() below ignores it.
   */
  offer?: OfferDraft;
};

export type OfferDraft = {
  college: string; pick: InstitutePick; degree: string; branch: string;
  /**
   * The admits row this came from, when it was loaded from one. Carried so an
   * offer keeps its identity across a round trip - the admin editor decides
   * "is this the student's or the school's?" by that key, and a new key would
   * quietly take a student's own offer away from them.
   */
  key?: string;
};

export const newOffer = (): OfferDraft => ({ college: '', pick: null, degree: '', branch: '' });

export const newAttempt = (exam: string): AttemptDraft => ({ key: newKey(), exam, year: '', rank: '', admit: '' });

/**
 * The offers claimed against an exam, as admit drafts - so one list, one
 * resolution loop and one set of rows reach the database, whichever question
 * the person answered.
 */
export function offerDrafts(attempts: AttemptDraft[]): AdmitDraft[] {
  return attempts
    .filter((t) => t.admit === 'yes' && t.offer && (t.offer.college.trim() || t.offer.pick))
    .map((t) => ({
      key: t.offer!.key ?? `attempt:${t.key}`,
      college: t.offer!.college,
      pick: t.offer!.pick,
      degree: t.offer!.degree,
      branch: t.offer!.branch,
      kind: 'entrance_exam' as AdmissionKind,
      exam: t.exam,
    }));
}

/**
 * The seat's own exam often opened more than one door. That second offer is
 * asked with the exam, stacked under it, rather than in the "anywhere else?"
 * block - so everything one exam produced reads as one thread. The exam that
 * won the seat cannot be a second attempt row (it is the seat), so its offer
 * needs a name of its own.
 */
export type SeatOffer = { exam: string; offer: OfferDraft | null };

export function seatOfferDraft(seat: SeatOffer | null | undefined): AdmitDraft[] {
  const o = seat?.offer;
  if (!seat?.exam.trim() || !o || !(o.college.trim() || o.pick)) return [];
  return [{
    key: o.key ?? 'seat-offer',
    college: o.college, pick: o.pick, degree: o.degree, branch: o.branch,
    kind: 'entrance_exam' as AdmissionKind, exam: seat.exam,
  }];
}

/** Every offer not taken: the ones claimed against an exam, then the rest. */
export function allOffers(admits: AdmitDraft[], attempts: AttemptDraft[], seat?: SeatOffer | null): AdmitDraft[] {
  return [...seatOfferDraft(seat), ...offerDrafts(attempts), ...admits];
}

/**
 * The rows for exam_attempts: every exam ticked, plus the one the seat came
 * through, marked as the seat. A tick for the seat's own exam in the same year
 * is the same attempt, not a second one.
 */
export function attemptRows(
  attempts: AttemptDraft[],
  seat: {
    admission: AdmissionDraft;
    /** The year the seat came - a year later after a year out (seatYear()). */
    year: number | null;
    /** An attempt with no year of its own: the year they finished school. */
    attemptYear: number | null;
  },
  examAliases?: Record<string, string>,
) {
  const rows = new Map<string, {
    exam: string; exam_year: number | null; exam_rank: number | null; gave_admit: boolean | null; got_seat: boolean;
  }>();
  const keyOf = (exam: string, year: number | null) => `${normText(exam)}|${year ?? 0}`;

  for (const t of attempts) {
    const exam = examCanonical(t.exam, examAliases) ?? cleanFreeText(t.exam);
    if (!exam || isTnea(exam)) continue;
    const year = toInt(t.year) ?? seat.attemptYear;
    rows.set(keyOf(exam, year), {
      exam, exam_year: year, exam_rank: toInt(t.rank),
      gave_admit: t.admit === 'yes' ? true : t.admit === 'no' ? false : null, got_seat: false,
    });
  }

  const a = seat.admission;
  if (a.kind === 'entrance_exam' && a.exam.trim()) {
    const exam = examCanonical(a.exam, examAliases) ?? cleanFreeText(a.exam)!;
    const k = keyOf(exam, seat.year);
    const had = rows.get(k);
    rows.set(k, {
      exam, exam_year: seat.year, exam_rank: toInt(a.rank) ?? had?.exam_rank ?? null,
      gave_admit: true, got_seat: true,
    });
  }
  return [...rows.values()].sort((x, y) => Number(y.got_seat) - Number(x.got_seat));
}

/** Saved attempts as the form's list - without the seat, which the admission block shows. */
export function attemptsFromRows(rows: {
  id?: string; exam: string; exam_year?: number | null; exam_rank?: number | null;
  gave_admit?: boolean | null; got_seat?: boolean | null;
}[], classOf: number | null): AttemptDraft[] {
  return rows.filter((r) => !r.got_seat).map((r) => ({
    key: r.id ?? newKey(),
    exam: r.exam,
    year: r.exam_year && r.exam_year !== classOf ? String(r.exam_year) : '',
    rank: r.exam_rank ? String(r.exam_rank) : '',
    admit: r.gave_admit === true ? 'yes' : r.gave_admit === false ? 'no' : '',
  }));
}

/* ─────────────────────────────────────────────────────────────────────────
   Offers not taken
───────────────────────────────────────────────────────────────────────── */
export type AdmitDraft = {
  key: string;
  college: string;
  pick: InstitutePick;
  degree: string;
  branch: string;
  kind: AdmissionKind | '';
  exam: string;
};

export const newAdmit = (): AdmitDraft => ({ key: newKey(), college: '', pick: null, degree: '', branch: '', kind: '', exam: '' });

/**
 * Rows for admits. `collegeIds` maps a draft's key to the college it was
 * linked to on save.
 *
 * The same offer can now be described twice - once against the exam that
 * produced it, once in the "anywhere else?" block - so rows are deduplicated
 * on exactly the key the database's `admits_once` index uses. Without this the
 * second one fails the insert and the whole batch is reported as lost.
 */
export function admitRowsWithKeys(
  admits: AdmitDraft[], year: number | null,
  collegeIds: Record<string, string | null> = {}, examAliases?: Record<string, string>,
) {
  const seen = new Set<string>();
  return admits
    .filter((d) => d.college.trim() || d.pick)
    .map((d) => {
      const kind = d.kind || null;
      const exam = kind === 'entrance_exam' ? (examCanonical(d.exam, examAliases) ?? cleanFreeText(d.exam)) : null;
      return {
        key: d.key,
        row: {
          college_id: collegeIds[d.key] ?? d.pick?.id ?? null,
          college_name_raw: cleanProperNoun(d.college),
          degree: cleanFreeText(d.degree),
          branch: cleanProperNoun(d.branch),
          route_kind: kind === 'entrance_exam' && !exam ? null : kind,
          exam,
          route_detail: null as string | null,
          admit_year: year,
        },
      };
    })
    // The database's own key: a linked college by id, otherwise by name.
    .filter(({ row }) => {
      const k = [
        row.college_id ?? (row.college_name_raw ?? '').toLowerCase(),
        (row.degree ?? '').toLowerCase(),
        row.admit_year ?? 0,
      ].join('|');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function admitRows(admits: AdmitDraft[], year: number | null, collegeIds: Record<string, string | null> = {}, examAliases?: Record<string, string>) {
  return admitRowsWithKeys(admits, year, collegeIds, examAliases).map(({ row }) => row);
}

export type AdmitRow = {
  id?: string; college_id?: string | null; college_name_raw?: string | null; college?: { name?: string } | null;
  degree?: string | null; branch?: string | null; route_kind?: AdmissionKind | null; exam?: string | null;
};

/**
 * Saved rows as the form's two lists, with each exam's offer back where it was
 * entered.
 *
 * An offer stored with `route_kind = 'entrance_exam'` belongs to the exam it
 * came through, so it hydrates into that attempt rather than into the
 * "anywhere else?" block - otherwise someone who filled it in once would find
 * it in both places on their next visit, and saving would write it twice.
 */
export function pathDraftsFromRows(
  attemptRowsIn: Parameters<typeof attemptsFromRows>[0],
  admitRowsIn: AdmitRow[],
  classOf: number | null,
  /** The exam their seat came through, so its own offer goes back to it. */
  seatExam?: string | null,
): { attempts: AttemptDraft[]; admits: AdmitDraft[]; seatOffer: OfferDraft | null } {
  const attempts = attemptsFromRows(attemptRowsIn, classOf);
  const claimed = new Set<number>();
  const asOffer = (r: AdmitRow): OfferDraft => {
    const name = r.college?.name ?? r.college_name_raw ?? '';
    return {
      college: name,
      pick: r.college_id ? { id: r.college_id, name } : null,
      degree: r.degree ?? '',
      branch: r.branch ?? '',
      key: r.id,
    };
  };

  // The seat's exam first: its offer belongs with it, not in the loose list.
  let seatOffer: OfferDraft | null = null;
  if (seatExam?.trim()) {
    const i = admitRowsIn.findIndex((r) => r.route_kind === 'entrance_exam' && normText(r.exam ?? '') === normText(seatExam));
    if (i >= 0) { claimed.add(i); seatOffer = asOffer(admitRowsIn[i]); }
  }
  for (const a of attempts) {
    if (a.admit !== 'yes') continue;
    const i = admitRowsIn.findIndex((r, idx) => !claimed.has(idx)
      && r.route_kind === 'entrance_exam' && normText(r.exam ?? '') === normText(a.exam));
    if (i < 0) continue;
    claimed.add(i);
    a.offer = asOffer(admitRowsIn[i]);
  }
  return { attempts, admits: admitsFromRows(admitRowsIn.filter((_, i) => !claimed.has(i))), seatOffer };
}

export function admitsFromRows(rows: AdmitRow[]): AdmitDraft[] {
  return rows.map((r) => {
    const name = r.college?.name ?? r.college_name_raw ?? '';
    return {
      key: r.id ?? newKey(),
      college: name,
      pick: r.college_id ? { id: r.college_id, name } : null,
      degree: r.degree ?? '',
      branch: r.branch ?? '',
      kind: r.route_kind ?? '',
      exam: r.exam ?? '',
    };
  });
}

/* ─────────────────────────────────────────────────────────────────────────
   A year out
───────────────────────────────────────────────────────────────────────── */
export type GapDraft = {
  /**
   * Right after Class 12: joined a college, took a year, or something else -
   * CA or CS on its own, work - which is neither, and must not be filed as a
   * year out.
   */
  afterSchool: '' | 'joined' | 'gap' | 'other';
  kind: '' | 'preparing' | 'break';
  exam: string;
  coaching: string;
  /** For a gap year: have they joined somewhere since? */
  joinedSince: '' | 'yes' | 'no';
};

export const emptyGap = (): GapDraft => ({ afterSchool: '', kind: '', exam: '', coaching: '', joinedSince: '' });

/** Did they join a college - straight away, or after their year out? */
export function joinedCollege(g: GapDraft): boolean {
  return g.afterSchool === 'joined' || (g.afterSchool === 'gap' && g.joinedSince === 'yes');
}

/** Still in the year out: the profile stays unlisted (migration 18). */
export function inGapYear(g: GapDraft): boolean {
  return g.afterSchool === 'gap' && g.joinedSince !== 'yes';
}

/** The year the seat came, for attempts and offers: a year later after a year out. */
export function seatYear(g: GapDraft, classOf: number | null): number | null {
  if (!classOf) return null;
  return g.afterSchool === 'gap' ? classOf + 1 : classOf;
}

export function gapProblem(g: GapDraft): string {
  if (!g.afterSchool) return 'Did you join a college right after Class 12?';
  if (g.afterSchool === 'gap') {
    if (!g.kind) return 'Was the year for preparing, or a break?';
    if (!g.joinedSince) return 'Have you joined a college since?';
  }
  return '';
}

/** The gap year starts in the year they finished school. */
export function gapRows(g: GapDraft, classOf: number | null, examAliases?: Record<string, string>) {
  if (g.afterSchool !== 'gap' || !g.kind || !classOf) return [];
  const preparing = g.kind === 'preparing';
  return [{
    gap_year: classOf,
    kind: g.kind,
    exam: preparing ? (examCanonical(g.exam, examAliases) ?? cleanFreeText(g.exam)) : null,
    coaching_name_raw: preparing ? cleanProperNoun(g.coaching) : null,
  }];
}

/**
 * The answers for a saved profile. With no gap-year row the answer is
 * "joined" when a college is on file, and "something else" otherwise - never
 * unanswered, so an older profile is not asked to explain itself on save.
 */
export function gapFromRows(
  rows: { gap_year: number; kind: 'preparing' | 'break'; exam?: string | null; coaching_name_raw?: string | null }[],
  inGap: boolean,
  hasCollege: boolean,
): GapDraft {
  const g = [...rows].sort((x, y) => y.gap_year - x.gap_year)[0];
  if (g) {
    return {
      afterSchool: 'gap', kind: g.kind, exam: g.exam ?? '', coaching: g.coaching_name_raw ?? '',
      joinedSince: inGap ? 'no' : 'yes',
    };
  }
  return { ...emptyGap(), afterSchool: hasCollege ? 'joined' : 'other' };
}

/* ─────────────────────────────────────────────────────────────────────────
   Family and home - private, never published
───────────────────────────────────────────────────────────────────────── */
export type Relation = '' | 'Father' | 'Mother' | 'Guardian';

export type FamilyDraft = {
  g1_name: string; g1_relation: Relation; g1_code: string; g1_phone: string;
  g2_on: boolean;
  g2_name: string; g2_relation: Relation; g2_code: string; g2_phone: string;
  address_line: string; town: string; district: string; state: string; pin: string;
};

export const emptyFamily = (): FamilyDraft => ({
  g1_name: '', g1_relation: '', g1_code: '+91', g1_phone: '',
  g2_on: false, g2_name: '', g2_relation: '', g2_code: '+91', g2_phone: '',
  address_line: '', town: '', district: '', state: 'Tamil Nadu', pin: '',
});

export type FamilyKey = keyof FamilyDraft;

/**
 * What is missing or wrong. `required` is registration's rule: everything but
 * the second parent. The school's editor saves whatever it has.
 */
export function familyProblems(
  f: FamilyDraft, required: boolean, phoneProblem: (code: string, phone: string) => string,
): Partial<Record<FamilyKey, string>> {
  const out: Partial<Record<FamilyKey, string>> = {};
  const need = (k: FamilyKey, msg: string) => { if (required && !String(f[k] ?? '').trim()) out[k] = msg; };
  need('g1_name', 'Your parent or guardian’s name.');
  need('g1_relation', 'Father, mother or guardian?');
  need('g1_phone', 'A number the school can reach them on.');
  if (f.g1_phone.trim()) {
    const p = phoneProblem(f.g1_code, f.g1_phone);
    if (p) out.g1_phone = p;
  }
  if (f.g2_on) {
    if (f.g2_name.trim() && !f.g2_relation) out.g2_relation = 'Father, mother or guardian?';
    if (f.g2_phone.trim()) {
      const p = phoneProblem(f.g2_code, f.g2_phone);
      if (p) out.g2_phone = p;
    }
  }
  need('address_line', 'House number and street.');
  need('town', 'Your town or city.');
  need('district', 'Your district.');
  need('state', 'Your state.');
  need('pin', 'Your PIN code.');
  if (f.pin.trim() && !/^[1-9][0-9]{5}$/.test(f.pin.trim())) out.pin = 'A PIN code is six digits.';
  return out;
}

/** The alumni_private row. Blank answers are stored as blank, not as "". */
export function privateRow(f: FamilyDraft) {
  const g2 = f.g2_on && f.g2_name.trim();
  return {
    guardian1_name: cleanProperNoun(f.g1_name),
    guardian1_relation: f.g1_relation || null,
    guardian1_phone_code: f.g1_code || '+91',
    guardian1_phone: digits(f.g1_phone) || null,
    guardian2_name: g2 ? cleanProperNoun(f.g2_name) : null,
    guardian2_relation: g2 ? (f.g2_relation || null) : null,
    guardian2_phone_code: g2 ? (f.g2_code || '+91') : null,
    guardian2_phone: g2 ? (digits(f.g2_phone) || null) : null,
    address_line: cleanFreeText(f.address_line),
    town: cleanProperNoun(f.town),
    district: cleanProperNoun(f.district),
    state: cleanProperNoun(f.state),
    pin: f.pin.trim() || null,
  };
}

export function familyFromRow(row: Record<string, any> | null | undefined): FamilyDraft {
  if (!row) return emptyFamily();
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    g1_name: s(row.guardian1_name), g1_relation: (row.guardian1_relation ?? '') as Relation,
    g1_code: s(row.guardian1_phone_code) || '+91', g1_phone: s(row.guardian1_phone),
    g2_on: !!row.guardian2_name,
    g2_name: s(row.guardian2_name), g2_relation: (row.guardian2_relation ?? '') as Relation,
    g2_code: s(row.guardian2_phone_code) || '+91', g2_phone: s(row.guardian2_phone),
    address_line: s(row.address_line), town: s(row.town), district: s(row.district),
    state: s(row.state) || 'Tamil Nadu', pin: s(row.pin),
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Branches that mean two things
───────────────────────────────────────────────────────────────────────── */
/**
 * "CS" and "CA" are never stored as aliases: under a BE, "CS" is Computer
 * Science and Engineering; under a BCom it is Corporate Secretaryship. With
 * the degree in view the form can tell, so it offers the reading that fits.
 */
export function contextualBranchAliases(degree: string): Record<string, string> {
  const d = normText(degree).replace(/[^a-z]/g, '');
  if (['be', 'btech', 'me', 'mtech'].includes(d)) return { cs: 'Computer Science and Engineering' };
  if (['bsc', 'msc', 'bca', 'mca'].includes(d)) return { cs: 'Computer Science' };
  if (['bcom', 'mcom', 'bba'].includes(d)) return { cs: 'Corporate Secretaryship', ca: 'Computer Applications' };
  return {};
}
