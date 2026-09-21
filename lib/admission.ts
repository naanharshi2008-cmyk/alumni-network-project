/**
 * The facts behind "how they got in", with no markup - so the profile page's
 * band, its path and the directory card's badge all read the same rule, and
 * lib/profilePath.ts can use it without pulling in React.
 */

import { asksForRank, publicRouteLabel } from './options';
import { formatMarksBand, formatRankBand } from './text';
import type { Alumnus } from './types';

/**
 * How they got in, as facts rather than markup: the route, and the score that
 * route makes meaningful.
 *
 * Shared by the directory card, the profile page's band and its path, so all
 * three agree about what may be shown. The rule is the one that has always
 * been here: show what the route makes true, not everything the row happens to
 * hold. Someone who typed a rank and then changed their route keeps the rank
 * in their profile; it just stops being shown beside a route it does not
 * belong to - which for Management Quota, displayed as "Board Marks", would
 * give away the very thing that label exists to hide.
 *
 * Scores are always bands (see formatRankBand in lib/text.ts). `cutoff` is
 * returned as typed; it is only ever shown muted.
 */
export function admissionFacts(a: Alumnus): {
  route: string | null;
  score: string | null;
  cutoff: string | null;
} {
  const onExam = asksForRank(a.admission_route);
  const rank = onExam ? formatRankBand(a.admission_rank) : null;
  const marks = !onExam ? formatMarksBand(a.board_marks) : null;
  return {
    route: publicRouteLabel(a.admission_route) || null,
    score: rank ?? (marks ? `${marks} marks` : null),
    cutoff: (a.board_cutoff ?? '').toString().trim() || null,
  };
}
