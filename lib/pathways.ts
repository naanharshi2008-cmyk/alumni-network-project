/**
 * Pathways: an area, the ways into it, and who took each.
 *
 * The owner's idea (Round 10): a junior browses by area - Engineering,
 * Medicine - then the pathways into it, and under each the seniors who wrote
 * that exam, who had an offer through it, and who joined through it. School
 * is not a grouping here; the path is.
 *
 * Pure: the pages fetch, this counts. The rules:
 *
 *   - An exam pathway sits under each of the exam's own areas (data on the
 *     exam, not a guess from whoever wrote it). Someone who wrote CUET appears
 *     under each of CUET's areas; someone who joined or was offered a seat
 *     through it appears under the area of that course.
 *   - Board marks, a management seat and other ways in sit under the area of
 *     what was joined or offered.
 *   - A person is counted once per pathway, in the strongest band they reach:
 *     joined, else had an offer, else wrote it. "Attempted is not admitted" -
 *     of 24 who wrote NEET in the school's own sheets, 8 are in medicine.
 *   - Preparing again is one number per area, from the database, never names
 *     (pathway_preparing_counts, migration 19).
 */

import { admissionOf } from './admission';
import { EXAMS, normText } from './exams';
import { collegeLabel } from './showcase';
import {
  CATEGORIES, categorize, categoryForDegree,
  type Alumnus, type CategoryKey, type PublicAdmit, type PublicExamAttempt,
} from './types';

export type PathwayPerson = {
  id: string;
  name: string;
  slug: string | null;
  classOf: number | null;
  photo: string | null;
  /** "BE at PSG Tech" - where they are, for the chip. */
  where: string;
};

export type Pathway = {
  key: string;
  kind: 'exam' | 'board_marks' | 'management' | 'other';
  label: string;
  joined: PathwayPerson[];
  offered: PathwayPerson[];
  wrote: PathwayPerson[];
};

export type AreaPathways = {
  key: CategoryKey;
  label: string;
  emoji: string;
  accent: string;
  /** Seniors whose own course is in this area. */
  people: number;
  pathways: Pathway[];
  /** How many are preparing again this year, when there are at least three. */
  preparing: number | null;
};

export type PathwaysInput = {
  alumni: Alumnus[];
  attempts: Pick<PublicExamAttempt, 'alumni_id' | 'exam' | 'gave_admit' | 'got_seat'>[];
  admits: Pick<PublicAdmit, 'alumni_id' | 'degree' | 'branch' | 'route_kind' | 'exam' | 'route_detail'>[];
  /** Each exam's areas from the database; the local list fills any gap. */
  examAreas?: Record<string, CategoryKey[]>;
  preparing?: { area: string; preparing: number }[];
};

/** The area of someone's own course. */
export function areaOf(a: Pick<Alumnus, 'field' | 'degree' | 'branch' | 'professional_course'>): CategoryKey {
  const byField = categorize(a.field);
  if (byField.key !== 'other') return byField.key;
  return categoryForDegree(a.degree, a.branch, a.professional_course)?.key ?? 'other';
}

function personOf(a: Alumnus): PathwayPerson {
  const college = collegeLabel(a);
  return {
    id: a.id as string,
    name: a.full_name,
    slug: a.public_slug || a.username || null,
    classOf: a.class_of,
    photo: a.show_photo ? a.photo_url : null,
    where: a.degree && college ? `${a.degree} at ${college}` : (college || a.degree || ''),
  };
}

type Bucket = { key: string; kind: Pathway['kind']; label: string; joined: Set<string>; offered: Set<string>; wrote: Set<string> };

export function buildPathways(input: PathwaysInput): AreaPathways[] {
  const byId = new Map(input.alumni.filter((a) => a.id).map((a) => [a.id as string, a]));
  const areas = new Map<CategoryKey, Map<string, Bucket>>();
  const bucket = (area: CategoryKey, key: string, kind: Bucket['kind'], label: string): Bucket => {
    let m = areas.get(area);
    if (!m) { m = new Map(); areas.set(area, m); }
    let b = m.get(key);
    if (!b) { b = { key, kind, label, joined: new Set(), offered: new Set(), wrote: new Set() }; m.set(key, b); }
    return b;
  };
  const local = new Map(EXAMS.map((e) => [normText(e.name), e.areas]));
  const examAreas = (exam: string): CategoryKey[] => {
    const fromDb = input.examAreas?.[exam] ?? Object.entries(input.examAreas ?? {}).find(([k]) => normText(k) === normText(exam))?.[1];
    return (fromDb?.length ? fromDb : local.get(normText(exam))) ?? [];
  };
  const routeBucket = (area: CategoryKey, kind: Bucket['kind'] | null, exam: string | null, detail: string | null) => {
    if (kind === 'exam') return exam ? bucket(area, `exam:${exam}`, 'exam', exam) : null;
    if (kind === 'board_marks') {
      return detail === 'TNEA'
        ? bucket(area, 'board:tnea', 'board_marks', 'Board marks (TNEA)')
        : bucket(area, 'board', 'board_marks', 'Board marks');
    }
    if (kind === 'management') return bucket(area, 'management', 'management', 'Management seat');
    if (kind === 'other') return bucket(area, 'other', 'other', 'Other ways in');
    return null;
  };

  // The seat each listed person joined through.
  for (const a of byId.values()) {
    const s = admissionOf(a);
    if (!s.kind) continue;
    routeBucket(areaOf(a), s.kind === 'entrance_exam' ? 'exam' : s.kind, s.exam, s.detail)?.joined.add(a.id as string);
  }

  // Every exam written. The seat is already counted above, from the profile.
  for (const t of input.attempts) {
    const a = byId.get(t.alumni_id);
    if (!a || t.got_seat) continue;
    const where = examAreas(t.exam);
    for (const area of where.length ? where : [areaOf(a)]) {
      const b = bucket(area, `exam:${t.exam}`, 'exam', t.exam);
      (t.gave_admit ? b.offered : b.wrote).add(t.alumni_id);
    }
  }

  // Offers not taken, under the area of the course offered.
  for (const d of input.admits) {
    const a = byId.get(d.alumni_id);
    if (!a || !d.route_kind) continue;
    const area = categoryForDegree(d.degree, d.branch, null)?.key ?? areaOf(a);
    routeBucket(area, d.route_kind === 'entrance_exam' ? 'exam' : d.route_kind, d.exam, d.route_detail)?.offered.add(d.alumni_id);
  }

  const prep = new Map((input.preparing ?? []).map((p) => [p.area, Number(p.preparing)]));
  const peopleIn = new Map<CategoryKey, number>();
  for (const a of byId.values()) peopleIn.set(areaOf(a), (peopleIn.get(areaOf(a)) ?? 0) + 1);

  const toPeople = (ids: Iterable<string>) => [...ids].map((id) => personOf(byId.get(id)!))
    .sort((x, y) => (y.classOf ?? 0) - (x.classOf ?? 0) || x.name.localeCompare(y.name));

  const out: AreaPathways[] = [];
  for (const cat of CATEGORIES) {
    const m = areas.get(cat.key);
    const preparing = prep.get(cat.key) ?? null;
    if (!m && !preparing) continue;
    const pathways: Pathway[] = [...(m?.values() ?? [])].map((b) => {
      const offered = [...b.offered].filter((id) => !b.joined.has(id));
      const wrote = [...b.wrote].filter((id) => !b.joined.has(id) && !b.offered.has(id));
      return { key: b.key, kind: b.kind, label: b.label, joined: toPeople(b.joined), offered: toPeople(offered), wrote: toPeople(wrote) };
    }).sort((x, y) => y.joined.length - x.joined.length
      || y.offered.length - x.offered.length || y.wrote.length - x.wrote.length || x.label.localeCompare(y.label));
    out.push({
      key: cat.key, label: cat.label, emoji: cat.emoji, accent: cat.accent,
      people: peopleIn.get(cat.key) ?? 0, pathways, preparing,
    });
  }
  return out.sort((x, y) => y.people - x.people || y.pathways.length - x.pathways.length);
}

/** "9 joined through it · 3 more had an offer · 39 wrote it" - only the parts that are not zero. */
export function pathwayCounts(p: Pathway): string {
  const parts = [
    p.joined.length ? `${p.joined.length} joined${p.kind === 'exam' ? ' through it' : ''}` : '',
    p.offered.length ? `${p.offered.length} ${p.joined.length ? 'more ' : ''}had an offer` : '',
    p.wrote.length ? `${p.wrote.length} ${p.joined.length || p.offered.length ? 'more ' : ''}wrote it` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}
