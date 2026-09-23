/**
 * LinkedIn as a username, not a link.
 *
 * The form used to ask for a full URL ("Start the link with https://"), which
 * students on a phone rarely have to hand - the app shares a link with a
 * tracking suffix, and the address bar is hidden. A username is what they can
 * see on their own profile, so that is what is asked; a pasted link of any
 * shape is read back to the username. The database builds the URL from it
 * (migration 18), and checks the same pattern as HANDLE_RE below.
 */

const HANDLE_RE = /^[a-z0-9_-]{3,100}$/;
const IN_LINK_RE = /linkedin\.com\/(?:mwlite\/)?in\/([^/?#\s]+)/i;

export type LinkedInParse = { handle: string | null; problem: string };

/**
 * What registration says when the box is empty (Round 11). Here rather than in
 * either caller because the field draws it and the step validator decides on
 * it, and the two saying different things would be a bug nobody notices.
 * `parseLinkedIn` still treats blank as fine - the profile editor, the office
 * and the import all leave it blank legitimately.
 */
export const LINKEDIN_REQUIRED = 'Add your LinkedIn username — it is how a junior reaches you.';

/** Read whatever was typed or pasted as a LinkedIn username. */
export function parseLinkedIn(input: string | null | undefined): LinkedInParse {
  const raw = (input ?? '').trim();
  if (!raw) return { handle: null, problem: '' };

  let candidate = raw;
  if (/linkedin\.com/i.test(raw)) {
    const m = raw.match(IN_LINK_RE);
    if (!m) {
      return { handle: null, problem: 'That link is not a personal profile — it should have /in/ in it.' };
    }
    candidate = m[1];
  } else {
    candidate = raw.replace(/^@/, '').replace(/^in\//i, '').replace(/\/+$/, '');
  }

  let handle = candidate;
  try { handle = decodeURIComponent(candidate); } catch { /* keep as typed */ }
  handle = handle.trim().toLowerCase();

  if (handle.length < 3) return { handle: null, problem: 'That looks too short for a LinkedIn username.' };
  if (!HANDLE_RE.test(handle)) {
    return {
      handle: null,
      problem: 'Use only letters, numbers and hyphens — it is the part after linkedin.com/in/ on your profile.',
    };
  }
  return { handle, problem: '' };
}

/** The profile address for a username. */
export function linkedinUrl(handle: string | null | undefined): string | null {
  const h = (handle ?? '').trim().toLowerCase();
  return h ? `https://www.linkedin.com/in/${h}` : null;
}

/** A stored link or username, as the username the form shows. */
export function handleFromStored(handle: string | null | undefined, url: string | null | undefined): string {
  if (handle) return handle;
  return parseLinkedIn(url).handle ?? '';
}
