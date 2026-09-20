/**
 * Where you were in the directory, so Back brings you back to it.
 *
 * Filters already survive a round trip because they are mirrored into the URL.
 * These do not: how far you scrolled, which batches you had opened, and how
 * many times you pressed "Show more". Opening a senior used to be a pop-up, so
 * none of it mattered; now it is a page, and losing your place on the way back
 * would be worse than the pop-up ever was.
 *
 * Written once, in the click that navigates away - not on unmount, not on
 * every scroll - because that is the only moment worth remembering.
 */

const KEY = 'veveaham.directory.view';
const TTL_MS = 30 * 60 * 1000;
/** Restoring 200 cards synchronously is its own kind of broken. */
const MAX_SHOWN = 60;

export type DirectorySnapshot = {
  /** The filters at write time. A different set means a different page. */
  search: string;
  scrollY: number;
  /**
   * Every group's state, not just the open ones. A list of open keys was
   * ambiguous: a group missing from it might have been closed deliberately or
   * simply never touched, and those two want opposite answers.
   */
  groups: Record<string, boolean>;
  shown: Record<string, number>;
  at: number;
};

export function rememberDirectoryView(snapshot: Omit<DirectorySnapshot, 'search' | 'at'>) {
  try {
    const payload: DirectorySnapshot = {
      ...snapshot,
      search: window.location.search,
      at: Date.now(),
    };
    window.sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Private windows, blocked storage, a full quota. The site simply behaves
    // the way it did before any of this existed.
  }
}

/**
 * The snapshot, if it still describes this page.
 *
 * Deliberately does NOT consume what it reads. React mounts a component
 * twice in development, so a read-and-delete gave the snapshot to a throwaway
 * first mount and nothing to the real one. Two guards do the job instead: the
 * filters in the URL must match, and it expires. Within those, restoring
 * someone's place is the point rather than a hazard.
 */
export function readDirectoryView(): DirectorySnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;

    const snap = JSON.parse(raw) as DirectorySnapshot;
    if (!snap || typeof snap.at !== 'number') return null;
    if (Date.now() - snap.at > TTL_MS) return null;
    // Different filters in the URL means the visitor did not come back to the
    // same view, so restoring depth and scroll would be wrong rather than kind.
    if (snap.search !== window.location.search) return null;

    for (const k of Object.keys(snap.shown ?? {})) {
      snap.shown[k] = Math.min(snap.shown[k], MAX_SHOWN);
    }
    return snap;
  } catch {
    return null;
  }
}

/** Called when the visitor reframes the list, which makes the snapshot wrong. */
export function clearDirectoryView() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}
