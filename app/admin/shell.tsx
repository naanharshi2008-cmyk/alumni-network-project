'use client';

import { createContext, useContext } from 'react';
import type { Counts } from './adminData';

/**
 * What the shell knows and the areas below need: the queue counts behind the
 * nav badges, a way to refresh them after a decision, and when this browser
 * last left the dashboard.
 *
 * Its own file because a Next layout may only export the layout itself.
 */
export type AdminShell = {
  counts: Counts;
  refreshCounts: () => void;
  lastVisit: number | null;
};

export const ShellContext = createContext<AdminShell>({
  counts: { registrations: 0, edits: 0, photos: 0, options: 0 },
  refreshCounts: () => {},
  lastVisit: null,
});

export function useAdminShell() {
  return useContext(ShellContext);
}
