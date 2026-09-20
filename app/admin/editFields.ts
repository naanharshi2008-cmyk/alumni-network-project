/**
 * What an admin is allowed to publish from a staged edit.
 *
 * `alumni.pending_changes` is written by the alumnus. The guard trigger copies
 * it verbatim - it has to, since it cannot know what a profile editor will
 * stage next year - so the blob is a convention, not a constraint. Publishing
 * then runs as the school, which the trigger treats as a trusted writer, so
 * whatever is in the blob lands in the live columns with every coercion
 * bypassed.
 *
 * That is how a staged `featured: true` could put someone on the home page,
 * and a staged `school_note` could write a line in the school's own voice -
 * neither of which the review screen ever showed, because the diff only
 * rendered the fields it had labels for.
 *
 * So: this list is the gate. Anything not on it is dropped at publish time and
 * reported to the admin as unrecognised rather than applied quietly.
 *
 * It is exactly the set `app/profile/page.tsx` builds in `columns` (see the
 * comment there): keep the two in step. The three contact fields are here
 * because an older client may still stage them; they are the person's own to
 * change live in any case, so publishing them grants nothing new.
 */
export const PUBLISHABLE_KEYS: ReadonlySet<string> = new Set([
  'full_name', 'school_name', 'school_board', 'admission_number', 'class_of', 'stream',
  'personal_email', 'phone_country_code', 'phone_number', 'linkedin_url',
  'college_id', 'college_name_raw', 'degree',
  'professional_course', 'professional_stage', 'professional_org',
  'branch', 'field', 'admission_route', 'admission_rank', 'board_marks', 'board_cutoff',
  'current_status', 'expected_finish_year', 'currently_at', 'organization_id', 'designation',
  'message_1', 'message_2', 'college_thoughts', 'photo_url', 'show_photo', 'consent_given',
]);

/** Staged keys that are whole tables, handled separately from the columns. */
export const TIMELINE_KEYS: ReadonlySet<string> = new Set(['higher_studies', 'work_experience']);

/** Split a staged blob into what may be published and what must not be. */
export function splitStaged(staged: Record<string, any> | null | undefined): {
  columns: Record<string, any>;
  unknown: [string, unknown][];
} {
  const columns: Record<string, any> = {};
  const unknown: [string, unknown][] = [];
  for (const [key, value] of Object.entries(staged ?? {})) {
    if (TIMELINE_KEYS.has(key)) continue;
    if (PUBLISHABLE_KEYS.has(key)) columns[key] = value;
    else unknown.push([key, value]);
  }
  return { columns, unknown };
}
