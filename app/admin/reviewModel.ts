import type {
  AlumniRow, PendingOption, PendingPhoto, ReviewData, TypedNameGroup,
} from './adminData';
import { splitStaged } from './editFields';

/**
 * One queue for everything waiting on the school.
 *
 * Five different things arrive from four tables - a registration, an edit to a
 * published profile, a campus photo, a value somebody typed under "Other", a
 * college name we could not match - and each used to live in its own tab with
 * its own count. Nothing said which had been waiting longest, so the oldest
 * item in the least-visited tab was the one that never got looked at.
 *
 * They become one list here, oldest first. The kind is a filter, not a
 * location.
 */

export type ReviewKind = 'registration' | 'edit' | 'photo' | 'option' | 'unmatched';

type Base = {
  /** `${kind}:${id}` - stable across refetches, which is what the cursor holds. */
  key: string;
  kind: ReviewKind;
  waitingSince: string;
  title: string;
  summary: string;
};

export type ReviewItem =
  | (Base & { kind: 'registration'; person: AlumniRow })
  | (Base & { kind: 'edit'; person: AlumniRow; changedCount: number; unknownCount: number })
  | (Base & { kind: 'photo'; photo: PendingPhoto })
  | (Base & { kind: 'option'; option: PendingOption })
  | (Base & { kind: 'unmatched'; entity: 'colleges' | 'organizations'; group: TypedNameGroup });

export const KIND_LABELS: Record<ReviewKind, string> = {
  registration: 'Registration',
  edit: 'Profile edit',
  photo: 'Campus photo',
  option: 'New value',
  unmatched: 'Unmatched name',
};

/** How long something has been sitting there, in words. */
export function waitedFor(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  return `${Math.floor(days / 30)} months`;
}

function editSummary(person: AlumniRow): { summary: string; changed: number; unknown: number } {
  const staged = person.pending_changes ?? {};
  const { columns, unknown } = splitStaged(staged);
  const changed = Object.keys(columns).filter((k) => (person as any)[k] !== columns[k]).length;
  const timelines = ['higher_studies', 'work_experience'].filter((k) => k in staged).length;
  const parts: string[] = [];
  if (changed) parts.push(`${changed} field${changed === 1 ? '' : 's'}`);
  if (timelines) parts.push(timelines === 2 ? 'study and work entries' : 'timeline entries');
  if (unknown.length) parts.push(`${unknown.length} we do not recognise`);
  return { summary: parts.join(', ') || 'nothing we can see', changed, unknown: unknown.length };
}

/** Everything waiting, oldest first. */
export function buildQueue(data: ReviewData): ReviewItem[] {
  const items: ReviewItem[] = [];

  for (const person of data.pending) {
    items.push({
      key: `registration:${person.id}`,
      kind: 'registration',
      waitingSince: person.created_at,
      title: person.full_name,
      summary: [person.class_of ? `Class of ${person.class_of}` : null, person.college_name_raw]
        .filter(Boolean).join(' · ') || 'A new registration',
      person,
    });
  }

  for (const person of data.pendingEdits) {
    const { summary, changed, unknown } = editSummary(person);
    items.push({
      key: `edit:${person.id}`,
      kind: 'edit',
      // Stamped when they staged the edit. It also moves when someone confirms
      // their profile is still correct, so it is a fair proxy and not a record
      // - migration 15 adds edits_staged_at for the honest answer.
      waitingSince: person.last_confirmed_at ?? person.created_at,
      title: person.full_name,
      summary: `Changed ${summary}`,
      person,
      changedCount: changed,
      unknownCount: unknown,
    });
  }

  for (const photo of data.photos) {
    const college = Array.isArray(photo.college) ? photo.college[0] : photo.college;
    const who = Array.isArray(photo.alumni) ? photo.alumni[0] : photo.alumni;
    items.push({
      key: `photo:${photo.id}`,
      kind: 'photo',
      waitingSince: photo.created_at,
      title: college?.name ?? 'A campus photo',
      summary: who ? `Shared by ${who.full_name}${who.class_of ? `, class of ${who.class_of}` : ''}` : 'Shared by someone',
      photo,
    });
  }

  for (const option of data.options) {
    items.push({
      key: `option:${option.id}`,
      kind: 'option',
      waitingSince: option.created_at,
      title: `“${option.value}”`,
      summary: `Typed under Other, for ${option.category.replace(/_/g, ' ')}`,
      option,
    });
  }

  for (const [entity, groups] of [
    ['colleges', data.unmatchedColleges],
    ['organizations', data.unmatchedCompanies],
  ] as const) {
    for (const group of groups) {
      items.push({
        key: `unmatched:${entity}:${group.key}`,
        kind: 'unmatched',
        waitingSince: group.waitingSince ?? new Date().toISOString(),
        title: group.display,
        summary: `Typed by ${group.alumniIds.length} ${group.alumniIds.length === 1 ? 'person' : 'people'}, matched to nothing`,
        entity,
        group,
      });
    }
  }

  // Oldest first: a photo that has waited three weeks matters more than a
  // registration from this morning, whatever tab they used to live in.
  return items.sort((a, b) =>
    a.waitingSince.localeCompare(b.waitingSince) || a.key.localeCompare(b.key));
}
