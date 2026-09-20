'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alumnus, HigherStudy } from '../lib/types';
import { classTag, collegeLabel, institutesFor, pathLine, profileHref, shortName, type Quote } from '../lib/showcase';
import { useCycle, useRotation } from '../lib/useRotation';

const SLOTS = 4;
const CARD_MS = 7000;   // long enough to read a college and a route
const QUOTE_MS = 13000; // a sentence of advice needs longer
const LABEL_MS = 5000;  // cycling between someone's two colleges

/**
 * The hero's right-hand side: real alumni photos turning slowly around one real
 * piece of advice.
 *
 * It shows exactly what exists. No photos yet: the school crest stands in as a
 * glowing seal. Fewer than four photos: that many cards, and nothing rotates.
 * Beyond four, one card at a time is exchanged for someone who has not been on
 * screen yet, so seven alumni are not represented by the same four faces.
 *
 * The collage is decorative next to the headline, so on narrow screens it is
 * hidden and the Featured row below carries the faces instead.
 */
export default function HeroCollage({
  faces, quotes, studies,
}: {
  /** The whole pool of photographed alumni, best first. */
  faces: Alumnus[] | null;
  quotes: Quote[];
  studies: Record<string, HigherStudy[]>;
}) {
  // Rotation stops while someone is reading: hovering, or tabbing through.
  const [paused, setPaused] = useState(false);
  const pool = faces ?? [];
  const slots = Math.min(SLOTS, pool.length);

  const cards = useRotation({ length: pool.length, slots, intervalMs: CARD_MS, paused });
  const quote = useRotation({ length: quotes.length, slots: 1, intervalMs: QUOTE_MS, paused });

  // Hold the space while loading so the headline column never jumps.
  if (faces === null) return <div className="collage collage--loading" aria-hidden />;

  const shown = quotes[quote.order[0]] ?? null;

  return (
    <div
      className={`collage collage--n${slots}${slots === 0 ? ' collage--sealed' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {slots === 0 && (
        <div className="collage__seal" aria-hidden>
          <img src="/brand/crest.png" alt="" width={256} height={256} />
        </div>
      )}

      {Array.from({ length: slots }, (_, slot) => {
        const person = pool[cards.order[slot]] ?? pool[slot];
        return person ? (
          <FaceCard
            key={slot}
            person={person}
            slot={slot}
            fading={cards.fading === slot}
            paused={paused}
            studies={studies[person.id ?? ''] ?? []}
          />
        ) : null;
      })}

      {shown && (
        <Link
          href={profileHref(shown.person)}
          className={`quote-card${quote.fading === 0 ? ' is-fading' : ''}`}
        >
          <span className="quote-card__mark" aria-hidden>“</span>
          <span className="quote-card__text">{shown.text}</span>
          <span className="quote-card__rule" aria-hidden />
          <span className="quote-card__who">{shortName(shown.person.full_name)}</span>
          <span className="quote-card__where">
            {[collegeLabel(shown.person), classTag(shown.person)].filter(Boolean).join(' ')}
          </span>
        </Link>
      )}
    </div>
  );
}

function FaceCard({
  person, slot, fading, paused, studies,
}: {
  person: Alumnus;
  slot: number;
  fading: boolean;
  paused: boolean;
  studies: HigherStudy[];
}) {
  const institutes = institutesFor(person, studies);
  const label = useCycle(institutes.length > 0 ? institutes : [shortName(person.full_name)], LABEL_MS, paused);
  const path = pathLine(person);

  return (
    <Link
      href={profileHref(person)}
      className={`face-card face-card--${slot}${fading ? ' is-fading' : ''}`}
      aria-label={`${person.full_name}${institutes.length ? `, ${institutes.join(', ')}` : ''}`}
    >
      <img src={person.photo_url!} alt="" loading="eager" decoding="async" />
      <span className="face-card__shade" aria-hidden />
      <span className="face-card__text">
        {/* Keyed so a change fades in rather than swapping mid-word. */}
        <span className="face-card__college" key={label}>{label}</span>
        {path && <span className="face-card__path">{path}</span>}
      </span>
      <span className="face-card__check" title="Approved by the school" aria-hidden>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
      </span>
    </Link>
  );
}
