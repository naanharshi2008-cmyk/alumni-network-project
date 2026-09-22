/**
 * The exam and branch lists the form pieces offer: the school's approved
 * values and their other spellings, from field_options (migration 18 seeded
 * both), with lib/exams.ts as the floor so the exam list is never empty even
 * before - or without - the fetch.
 */

import { EXAMS, normText } from '../exams';

type Options = Record<string, string[]>;
type Aliases = Record<string, Record<string, string>>;

export type Vocab = { options: string[]; aliases: Record<string, string> };

export function examVocab(approved: Options, aliases: Aliases): Vocab {
  const local: Record<string, string> = {};
  for (const e of EXAMS) for (const a of e.aliases ?? []) local[normText(a)] = e.name;
  const names = [...EXAMS.map((e) => e.name), ...(approved.exam ?? [])];
  const seen = new Set<string>();
  const options = names.filter((n) => {
    const k = normText(n);
    if (seen.has(k) || k === 'tnea') return false;
    seen.add(k);
    return true;
  });
  return { options, aliases: { ...local, ...(aliases.exam ?? {}) } };
}

export function branchVocab(approved: Options, aliases: Aliases): Vocab {
  const options = [...new Set(approved.branch ?? [])].sort((x, y) => x.localeCompare(y));
  return { options, aliases: aliases.branch ?? {} };
}

/** The canonical branch for what was typed, or the typing tidied. */
export function canonicalBranch(typed: string, v: Vocab, extra: Record<string, string> = {}): string {
  const k = normText(typed);
  if (!k) return '';
  return extra[k] ?? v.aliases[k] ?? v.options.find((o) => normText(o) === k) ?? typed.replace(/\s+/g, ' ').trim();
}
