'use client';

import { useMemo } from 'react';
import { Alumnus, collegeNameOf } from '../lib/types';
import { EXAM_ROUTES } from '../lib/options';

/**
 * "19 seniors · 16 colleges · 4 entrance exams" under the hero.
 *
 * The hero makes a claim; this is the evidence for it, and it is the first
 * thing a sceptical parent looks for. It also frames a small directory
 * honestly - a real number reads as "young and growing", where an unexplained
 * handful of cards reads as "abandoned".
 *
 * Takes the alumni rows as a prop: the home page fetches once and shares the
 * data with the galleries, instead of every hero component fetching for
 * itself. Renders nothing until there is something true to say, so the hero
 * is never pushed around by a loading state.
 */
export default function HeroStats({ alumni }: { alumni: Alumnus[] | null }) {
  const stats = useMemo(() => {
    if (!alumni || alumni.length === 0) return null;

    const colleges = new Set<string>();
    const exams = new Set<string>();
    for (const a of alumni) {
      const college = collegeNameOf(a) ?? a.college_name_raw;
      if (college) colleges.add(college.trim().toLowerCase());
      // Only count actual entrance exams: "Board Marks" and "Merit / Direct"
      // are routes, not exams, and counting them would overstate this.
      if (a.admission_route && (EXAM_ROUTES as readonly string[]).includes(a.admission_route)) {
        exams.add(a.admission_route);
      }
    }
    return { seniors: alumni.length, colleges: colleges.size, exams: exams.size };
  }, [alumni]);

  if (!stats) return null;

  return (
    <div className="stats fade-up" aria-label="What the directory currently holds">
      <div className="stat">
        <span className="stat__num">{stats.seniors}</span>
        <span className="stat__label">{stats.seniors === 1 ? 'senior' : 'seniors'}</span>
      </div>
      <div className="stat">
        <span className="stat__num">{stats.colleges}</span>
        <span className="stat__label">{stats.colleges === 1 ? 'college' : 'colleges'}</span>
      </div>
      {stats.exams > 0 && (
        <div className="stat">
          <span className="stat__num">{stats.exams}</span>
          <span className="stat__label">{stats.exams === 1 ? 'entrance exam' : 'entrance exams'}</span>
        </div>
      )}
    </div>
  );
}
