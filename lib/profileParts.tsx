/**
 * Small pieces of a profile the directory card draws.
 *
 * No 'use client' and no hooks on purpose, so a server page can render them as
 * readily as the directory's client bundle. The facts underneath them live in
 * lib/admission.ts, which the profile page reads directly - so the card and
 * the page still cannot describe the same person differently.
 */

import React from 'react';
import { admissionFacts } from './admission';
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

/**
 * "How they got in", on a card: the route as the badge, the score beneath it.
 *
 * The two used to sit side by side as equal badges - [via NEET] [Rank
 * 1,000–5,000] - so every card opened with a number. The route is what tells a
 * junior the path exists; the band stays for anyone who wants it, small and
 * muted, underneath.
 */
export function AdmissionBadges({ a }: { a: Alumnus }) {
  const { phrase, score } = admissionFacts(a);
  if (!phrase && !score) return null;

  return (
    <div className="admission-row">
      {phrase && <span className="badge badge--xs">via {phrase}</span>}
      {score && <span className="admission-row__score">{score}</span>}
    </div>
  );
}
