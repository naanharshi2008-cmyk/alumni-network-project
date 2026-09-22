/**
 * The entrance exams, with the areas each belongs to and the spellings
 * students actually use.
 *
 * The database is the source of truth - migration 18 seeded these into
 * `field_options` (category 'exam'), and the school can approve more there,
 * each with its own areas. This copy is what code needs before any fetch: the
 * registration draft, the import preview, and kindFromLegacyRoute(), which
 * must agree with the SQL function admission_from_route() it mirrors.
 *
 * TNEA is deliberately absent: it is Tamil Nadu's counselling on board marks,
 * not an exam, and 54 students in the school's own form ticked it as one.
 * CA / CS / CMA Foundation is absent too - it is a professional course.
 */

import type { CategoryKey } from './types';

export type ExamEntry = { name: string; areas: CategoryKey[]; aliases?: string[] };

export const EXAMS: ExamEntry[] = [
  { name: 'JEE Main', areas: ['engineering', 'architecture'], aliases: ['JEE', 'JEE Mains', 'JEE (Main)', 'JEE-Main'] },
  { name: 'JEE Advanced', areas: ['engineering', 'sciences'], aliases: ['JEE Adv', 'JEE Advance'] },
  { name: 'NEET', areas: ['medicine', 'nursing'], aliases: ['NEET UG', 'NEET-UG', 'NEET (AYUSH)'] },
  { name: 'CUET', areas: ['sciences', 'commerce', 'humanities', 'management'], aliases: ['CUET UG', 'CUET-UG'] },
  { name: 'AMRITAEEE', areas: ['engineering'], aliases: ['AEEE', 'Amrita EEE', 'Amrita AEEE'] },
  { name: 'VITEEE', areas: ['engineering'], aliases: ['VITEE', 'VIT EEE'] },
  { name: 'SRMJEEE', areas: ['engineering'], aliases: ['SRMJEE', 'SRM JEE', 'SRM JEEE'] },
  { name: 'BITSAT', areas: ['engineering'] },
  { name: 'COMEDK', areas: ['engineering'], aliases: ['COMEDK UGET'] },
  { name: 'SNUCEE', areas: ['engineering'], aliases: ['SNU CEE'] },
  { name: 'SNUSAT', areas: ['engineering', 'sciences', 'management', 'humanities'], aliases: ['SNU SAT'] },
  { name: 'KEE', areas: ['engineering'], aliases: ['Karunya Entrance Examination', 'KEE (Karunya)'] },
  { name: 'JET', areas: ['engineering'], aliases: ['Jain Entrance Test', 'JET (Jain)'] },
  { name: 'MET', areas: ['engineering'], aliases: ['Manipal Entrance Test', 'MAHE'] },
  { name: 'NIAT', areas: ['engineering', 'computer_applications'] },
  { name: 'KCET', areas: ['engineering', 'agriculture', 'pharmacy'] },
  { name: 'MHT-CET', areas: ['engineering', 'pharmacy', 'agriculture'], aliases: ['MHT CET', 'MHTCET'] },
  { name: 'KEAM', areas: ['engineering', 'pharmacy'] },
  { name: 'WBJEE', areas: ['engineering'] },
  { name: 'IAT (IISER Aptitude Test)', areas: ['sciences'], aliases: ['IAT', 'IISER', 'IISER Aptitude Test'] },
  { name: 'NEST', areas: ['sciences'] },
  { name: 'CMI', areas: ['sciences'] },
  { name: 'ISI', areas: ['sciences'] },
  { name: 'CLAT', areas: ['law'] },
  { name: 'NATA', areas: ['architecture'] },
  { name: 'NDA', areas: ['defence'] },
];

/** Lower case, spaces collapsed - the one comparison every typed value gets. */
export function normText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const BY_SPELLING = new Map<string, string>();
for (const e of EXAMS) {
  BY_SPELLING.set(normText(e.name), e.name);
  for (const a of e.aliases ?? []) BY_SPELLING.set(normText(a), e.name);
}

/**
 * The canonical name for a typed exam, or null when it is not one we know.
 * `extra` carries aliases fetched from the database (fetchOptionAliases()),
 * so a spelling the school merged last week is understood too.
 */
export function examCanonical(value: string | null | undefined, extra?: Record<string, string>): string | null {
  const key = normText(value);
  if (!key) return null;
  return BY_SPELLING.get(key) ?? extra?.[key] ?? null;
}

/** The areas an exam belongs to; empty for an exam this copy does not know. */
export function examAreas(exam: string | null | undefined): CategoryKey[] {
  const name = examCanonical(exam) ?? exam ?? '';
  return EXAMS.find((e) => e.name === name)?.areas ?? [];
}

/** The typed answer that is really TNEA, so the form can say where it belongs. */
export function isTnea(value: string | null | undefined): boolean {
  return normText(value) === 'tnea';
}
