'use client';

import Link from 'next/link';
import { Alumnus } from '../lib/types';
import { classTag, collegeLabel, pathLine, profileHref, shortName, type Quote } from '../lib/showcase';

/**
 * The hero's right-hand side: real alumni photos floating around one real
 * piece of advice.
 *
 * It shows exactly what exists. No photos yet: the school crest stands in as a
 * glowing seal. One to three photos: that many cards. The collage is decorative
 * next to the headline, so on narrow screens it is hidden and the Featured row
 * below carries the faces instead.
 */
export default function HeroCollage({ faces, quote }: { faces: Alumnus[] | null; quote: Quote | null }) {
  // Hold the space while loading so the headline column never jumps.
  if (faces === null) return <div className="collage collage--loading" aria-hidden />;

  return (
    <div className={`collage collage--n${faces.length}${faces.length === 0 ? ' collage--sealed' : ''}`}>
      {faces.length === 0 && (
        <div className="collage__seal" aria-hidden>
          <img src="/brand/crest.png" alt="" width={256} height={256} />
        </div>
      )}

      {faces.map((a, i) => {
        const college = collegeLabel(a);
        const path = pathLine(a);
        return (
          <Link
            key={a.id ?? i}
            href={profileHref(a)}
            className={`face-card face-card--${i}`}
            aria-label={`${a.full_name}${college ? `, ${college}` : ''}`}
          >
            <img src={a.photo_url!} alt="" loading="eager" decoding="async" />
            <span className="face-card__shade" aria-hidden />
            <span className="face-card__text">
              <span className="face-card__college">{college ?? shortName(a.full_name)}</span>
              {path && <span className="face-card__path">{path}</span>}
            </span>
            <span className="face-card__check" title="Approved by the school" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
            </span>
          </Link>
        );
      })}

      {quote && (
        <Link href={profileHref(quote.person)} className="quote-card">
          <span className="quote-card__mark" aria-hidden>“</span>
          <span className="quote-card__text">{quote.text}</span>
          <span className="quote-card__rule" aria-hidden />
          <span className="quote-card__who">{shortName(quote.person.full_name)}</span>
          <span className="quote-card__where">
            {[collegeLabel(quote.person), classTag(quote.person)].filter(Boolean).join(' ')}
          </span>
        </Link>
      )}
    </div>
  );
}
