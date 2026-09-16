'use client';

import Link from 'next/link';
import { Alumnus, collegeDetailsOf, initialsOf, professionalLabel } from '../lib/types';
import { classTag, collegeLabel, instituteInitials, pathLine, profileHref, shortName } from '../lib/showcase';

/**
 * Featured alumni: the school's starred picks first, the most complete
 * profiles after, rotating every few hours (see lib/showcase.ts).
 *
 * Each card leads with where the person went - the college's banner when the
 * school has uploaded one, otherwise a tile with its initials - because that is
 * what a junior scanning the row is looking for.
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
          <p>Real seniors. Real paths.</p>
        </div>
        <Link href="/directory" className="featured__all">
          View all alumni <span aria-hidden>→</span>
        </Link>
      </div>

      <div className="featured__row">
        {people.map((a, i) => {
          const college = collegeLabel(a);
          const banner = collegeDetailsOf(a)?.banner_url;
          const title = college ?? a.currently_at ?? professionalLabel(a) ?? 'Veveaham alumni';
          const path = pathLine(a);
          return (
            <Link key={a.id ?? i} href={profileHref(a)} className="f-card">
              <span className="f-card__thumb" aria-hidden>
                {banner
                  ? <img src={banner} alt="" loading="lazy" decoding="async" />
                  : <span className="f-card__tile">{instituteInitials(title)}</span>}
              </span>
              <span className="f-card__body">
                <span className="f-card__title">{title}</span>
                {path && <span className="f-card__path">{path}</span>}
                <span className="f-card__foot">
                  <span className="f-card__avatar" aria-hidden>
                    {a.photo_url
                      ? <img src={a.photo_url} alt="" loading="lazy" decoding="async" />
                      : initialsOf(a.full_name)}
                  </span>
                  <span className="f-card__name">
                    {shortName(a.full_name)}
                    {classTag(a) && <span className="f-card__year"> {classTag(a)}</span>}
                  </span>
                  <span className="f-card__go" aria-hidden>›</span>
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
