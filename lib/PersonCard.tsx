/**
 * One senior, as a card: their face and name first, then where they went.
 *
 * The featured row used to lead with the college - a 94x120 campus banner,
 * with the college's initials as the largest text on the card - while the
 * person's own photo was a 26px circle in the footer, a sixteenth of the area.
 * On a card about a person, the institution had the space. This turns it round:
 * the face is the largest thing, the name is the headline, and what they
 * joined - the degree and the college, with its logo - is a real second line
 * rather than a caption.
 *
 * No 'use client' and no hooks, so the home page (a client component) and any
 * server page can both render it.
 *
 * The photo needs no show_photo check here: the public_alumni view has nulled
 * photo_url for hidden photos since migration 01.
 */

import Link from 'next/link';
import { publicRouteLabel } from './options';
import { classTag, collegeLabel, collegeTintKey, instituteTint, profileHref, shortName } from './showcase';
import { type Alumnus, collegeDetailsOf, initialsOf, professionalLabel } from './types';

type Size = 'lg' | 'md';

/**
 * The "where" line.
 *
 * `lg` says the whole thing - "BS-MS at IISER Thiruvananthapuram" - because on
 * the home page the college is the news. `md` is used on a college's own page,
 * where the college is the page, so it says only the course.
 *
 * Never falls back to the words "Veveaham alumni": a card that says nothing
 * about where someone went should say nothing, not something that reads like
 * an institution.
 */
function whereLine(a: Alumnus, size: Size): string {
  const course = a.degree || professionalLabel(a) || '';
  if (size === 'md') {
    return [a.degree, a.branch].filter(Boolean).join(' · ') || professionalLabel(a) || '';
  }
  const college = collegeLabel(a);
  if (course && college) return `${course} at ${college}`;
  return college || course || a.currently_at || '';
}

export default function PersonCard({ a, size = 'lg' }: { a: Alumnus; size?: Size }) {
  const tintKey = collegeTintKey(a);
  const where = whereLine(a, size);
  const route = publicRouteLabel(a.admission_route);
  const logo = size === 'lg' ? collegeDetailsOf(a)?.logo_url : null;
  const year = classTag(a);
  const face = size === 'lg' ? 88 : 64;

  return (
    <Link href={profileHref(a)} className={`pcard pcard--${size}`}>
      <span
        className="pcard__face" aria-hidden
        style={tintKey ? ({ '--tint': instituteTint(tintKey) } as React.CSSProperties) : undefined}
      >
        {a.photo_url
          ? <img src={a.photo_url} alt="" width={face} height={face} loading="lazy" decoding="async" />
          : <span className="pcard__initials">{initialsOf(a.full_name)}</span>}
      </span>
      <span className="pcard__body">
        <span className="pcard__name">
          {shortName(a.full_name)}
          {year && <span className="pcard__year"> {year}</span>}
        </span>
        {where && (
          <span className="pcard__where">
            {logo && <span className="pcard__logo" aria-hidden><img src={logo} alt="" loading="lazy" /></span>}
            {where}
          </span>
        )}
        {route && <span className="pcard__how">via {route}</span>}
      </span>
    </Link>
  );
}
