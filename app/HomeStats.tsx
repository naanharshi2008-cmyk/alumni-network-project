'use client';

import { useMemo } from 'react';
import { Alumnus } from '../lib/types';
import { homeStats } from '../lib/showcase';

/**
 * The evidence row under Featured: exact counts from approved profiles.
 * Never rounded up to a "1,250+" and never shown as a zero - a young directory
 * with honest numbers reads as growing, an inflated one reads as fake.
 */
export default function HomeStats({ alumni }: { alumni: Alumnus[] }) {
  const s = useMemo(() => homeStats(alumni), [alumni]);

  const items = [
    { n: s.alumni, one: 'alumnus', many: 'alumni', icon: <PeopleIcon />, tone: 'violet' },
    { n: s.colleges, one: 'college', many: 'colleges', icon: <CollegeIcon />, tone: 'emerald' },
    { n: s.exams, one: 'entrance exam', many: 'entrance exams', icon: <StarIcon />, tone: 'gold' },
    { n: s.batches, one: 'batch', many: 'batches', icon: <CapIcon />, tone: 'sky' },
  ].filter((x) => x.n > 0);

  if (items.length === 0) return null;

  return (
    <section className="h-stats fade-up" aria-label="What the directory holds today">
      {items.map((x) => (
        <div key={x.many} className={`h-stat h-stat--${x.tone}`}>
          <span className="h-stat__icon" aria-hidden>{x.icon}</span>
          <span className="h-stat__text">
            <span className="h-stat__num">{x.n.toLocaleString('en-IN')}</span>
            <span className="h-stat__label">{x.n === 1 ? x.one : x.many}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

const svg = { width: 30, height: 30, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function PeopleIcon() {
  return <svg {...svg}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.2c2.4.1 4 1.7 4.5 4.3" /></svg>;
}
function CollegeIcon() {
  return <svg {...svg}><path d="M3 9.5 12 4l9 5.5" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20.5h18" /></svg>;
}
function StarIcon() {
  return <svg {...svg}><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" /></svg>;
}
function CapIcon() {
  return <svg {...svg}><path d="M2.5 9.5 12 5l9.5 4.5L12 14 2.5 9.5Z" /><path d="M6.5 11.5V16c1.4 1.3 3.3 2 5.5 2s4.1-.7 5.5-2v-4.5" /><path d="M21.5 9.5V15" /></svg>;
}
