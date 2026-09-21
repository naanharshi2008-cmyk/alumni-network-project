'use client';

import Link from 'next/link';
import type { Alumnus } from '../lib/types';
import PersonCard from '../lib/PersonCard';

/**
 * Featured alumni: the school's starred picks first, the most complete
 * profiles after, rotating every few hours (see lib/showcase.ts).
 *
 * Each card leads with the person - their face and their name - and then
 * where they went. It used to be the other way round, with a campus banner
 * the size of the card and the person's photo a 26px circle in its footer;
 * see lib/PersonCard.tsx.
 */
export default function FeaturedAlumni({ people }: { people: Alumnus[] }) {
  if (people.length === 0) return null;

  return (
    <section className="featured fade-up" aria-labelledby="featured-title">
      <div className="featured__head">
        <span className="featured__spark" aria-hidden>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c.5 4.6 2.9 7 7.5 7.5-4.6.5-7 2.9-7.5 7.5-.5-4.6-2.9-7-7.5-7.5 4.6-.5 7-2.9 7.5-7.5Z" /><path d="M19 15.5c.2 1.8 1.2 2.8 3 3-1.8.2-2.8 1.2-3 3-.2-1.8-1.2-2.8-3-3 1.8-.2 2.8-1.2 3-3Z" opacity=".7" /></svg>
        </span>
        <div className="featured__titles">
          <h2 id="featured-title">Featured alumni</h2>
          <p>Seniors from your school, and where they are now.</p>
        </div>
        <Link href="/directory" className="featured__all">
          View all alumni <span aria-hidden>→</span>
        </Link>
      </div>

      <div className="featured__row">
        {people.map((a, i) => <PersonCard key={a.id ?? i} a={a} size="lg" />)}
      </div>
    </section>
  );
}
