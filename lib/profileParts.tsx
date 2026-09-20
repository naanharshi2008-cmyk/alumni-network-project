/**
 * The pieces of a profile that both the directory and a person's own page draw.
 *
 * No 'use client' and no hooks on purpose: a server component renders these on
 * the server for the profile page, and the directory pulls the same code into
 * the browser bundle. One definition either way, so the two surfaces cannot
 * drift into describing the same person differently.
 */

import React from 'react';
import { asksForRank, publicRouteLabel } from './options';
import { formatMarksBand, formatRankBand } from './text';
import type { Alumnus } from './types';

/* ─────────────────────────────────────────────────────────────────────────
   Utility components
───────────────────────────────────────────────────────────────────────── */
export function Row({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="a-row">
      <span className="a-row__icon" aria-hidden>{icon}</span>
      <span><span className="a-row__label">{label}: </span>{children}</span>
    </div>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="college-facts__label">{label}</p>
      <p className="college-facts__value">{value}</p>
    </div>
  );
}

/**
 * "How they got in", as badges.
 *
 * This is the answer a visiting student came for, so it appears on the card,
 * in the modal, and on the Explorer mini-card rather than being buried.
 *
 * The route leads and is always shown when present - every one of the alumni
 * on an exam route has one, and "via JEE Main" states that the path exists
 * without ranking anybody. Rank and marks follow only when given, and always
 * as bands: see formatRankBand in lib/text.ts for why exact figures are the
 * wrong call here.
 */
export function AdmissionBadges({ a, showStatus = false }: { a: Alumnus; showStatus?: boolean }) {
  // Show what the route makes true, not everything the row happens to hold.
  // Someone who typed a rank and then changed their route keeps the rank in
  // their profile; it just stops being shown beside a route it does not
  // belong to - which for Management Quota, displayed as "Board Marks", would
  // give away the very thing that label exists to hide.
  const onExam = asksForRank(a.admission_route);
  const rank = onExam ? formatRankBand(a.admission_rank) : null;
  const marks = !onExam ? formatMarksBand(a.board_marks) : null;
  if (!a.admission_route && !rank && !marks) return null;

  return (
    <div className="admission-row">
      {a.admission_route && <span className="badge badge--xs">via {publicRouteLabel(a.admission_route)}</span>}
      {rank && <span className="badge badge--xs">{rank}</span>}
      {marks && <span className="badge badge--xs">{marks} marks</span>}
      {showStatus && a.current_status && (
        <span className="badge badge--xs" style={{ opacity: 0.75 }}>{a.current_status}</span>
      )}
    </div>
  );
}
