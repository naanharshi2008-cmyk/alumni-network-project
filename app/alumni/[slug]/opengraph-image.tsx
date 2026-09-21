import { fetchAlumnusBySlug } from '../../../lib/publicData';
import { renderProfileCard, OG_SIZE } from '../../../lib/og/card';
import { FALLBACK_TINT, collegeLabel, collegeTintKey, instituteTint } from '../../../lib/showcase';
import { initialsOf } from '../../../lib/types';
import { publicRouteLabel } from '../../../lib/options';

/**
 * The card a WhatsApp group sees when somebody shares a senior.
 *
 * The file convention rather than an /api route, so Next emits og:image,
 * og:image:width and og:image:height itself - WhatsApp renders the large card
 * far more reliably when the dimensions are declared - and so the URL is
 * resolved from metadataBase rather than assembled by hand in every page.
 */
export const alt = 'Veveaham alumni profile';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { person } = await fetchAlumnusBySlug(slug);

  if (!person) {
    return renderProfileCard({
      name: 'Veveaham Alumni',
      college: null, route: null, photoUrl: null,
      initials: 'V', tint: FALLBACK_TINT,
    });
  }

  const key = collegeTintKey(person);
  return renderProfileCard({
    name: person.full_name,
    classOf: person.class_of,
    college: collegeLabel(person),
    route: publicRouteLabel(person.admission_route),
    photoUrl: person.show_photo ? person.photo_url : null,
    initials: initialsOf(person.full_name),
    tint: key ? instituteTint(key) : FALLBACK_TINT,
  });
}
