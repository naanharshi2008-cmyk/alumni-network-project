import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { fetchAlumnusBySlug, fetchPathExtras, fetchRelatedAlumni, fetchTimelines } from '../../../lib/publicData';
import { admissionFacts } from '../../../lib/admission';
import { nowOf, pathIsWorthDrawing, pathSteps, shortSchoolName } from '../../../lib/profilePath';
import {
  FALLBACK_TINT, collegeLabel, collegeTintKey, instituteTint, looksLikeWords, profileHref, profileSummary, shortName,
} from '../../../lib/showcase';
import { formatMonthYear } from '../../../lib/text';
import {
  SCHOOL_GROUP_NAME, collegeDetailsOf, initialsOf, professionalLabel,
  sortHigherStudies, sortWorkExperience,
} from '../../../lib/types';
import ShareButton from './ShareButton';

/**
 * One senior, at an address of their own.
 *
 * A profile used to exist only as a pop-up over the directory, which meant the
 * link you could share was a query parameter on a page rendered entirely in
 * the browser - and the crawler that builds a WhatsApp preview runs no
 * JavaScript, so every senior shared into a group chat looked like the same
 * generic site. This page renders on the server for exactly that reason.
 *
 * It reads with the anon key, the same privilege the visitor's own browser
 * has, against the public_alumni view - which does not contain a phone number
 * or an email address to leak.
 */

export const revalidate = 3600;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { person } = await fetchAlumnusBySlug(slug);
  if (!person) return { title: 'Profile not found', robots: { index: false, follow: false } };

  const summary = profileSummary(person);
  const college = collegeLabel(person);
  const path = `/alumni/${person.public_slug ?? slug}`;

  return {
    title: `${person.full_name}${person.class_of ? ` — Class of ${person.class_of}` : ''}`,
    description: summary,
    alternates: { canonical: path },
    openGraph: {
      type: 'profile',
      siteName: 'Veveaham Alumni',
      title: [person.full_name, college].filter(Boolean).join(' — '),
      description: summary,
      url: path,
    },
    twitter: { card: 'summary_large_image', title: person.full_name, description: summary },
    robots: { index: true, follow: true },
  };
}

export default async function AlumnusPage({ params }: Props) {
  const { slug } = await params;
  const { person, canonical } = await fetchAlumnusBySlug(slug);
  if (!person) notFound();
  // Reached by an old username link: answer once, then settle on one address.
  if (canonical && canonical !== slug) permanentRedirect(`/alumni/${canonical}`);

  const [timelines, rails, extrasById] = await Promise.all([
    fetchTimelines([person.id as string]),
    fetchRelatedAlumni(person),
    fetchPathExtras([person.id as string]),
  ]);
  const extras = extrasById[person.id as string];
  const studies = sortHigherStudies(timelines.studies[person.id as string] ?? []);
  const work = sortWorkExperience(timelines.work[person.id as string] ?? []);

  const a = person;
  const det = collegeDetailsOf(a);
  const college = collegeLabel(a);
  const tintKey = collegeTintKey(a);
  const facts = admissionFacts(a);
  const steps = pathSteps(a, studies, work, extras);
  const now = nowOf(a, studies, work);

  // The one line that says where they went. First match wins; with none of
  // these there is simply no line, rather than a placeholder.
  const course = a.degree || '';
  const prof = professionalLabel(a);
  const strong =
    course && college ? `${course} at ${college}`
      : college ? college
        : course && a.branch ? `${course} in ${a.branch}`
          : course ? course
            : prof ? [prof, a.professional_org ? `at ${a.professional_org}` : null].filter(Boolean).join(' ')
              : '';

  // Their own words. The first one they wrote leads; the rest follow smaller,
  // each labelled, so three quotes do not read as three equal boxes.
  const words = [
    { key: 'm1', label: null, text: a.message_1 },
    { key: 'm2', label: 'Looking back', text: a.message_2 },
    { key: 'ct', label: college ? `About ${college}` : 'About their college', text: a.college_thoughts },
  ].filter((w) => (w.text ?? '').trim());

  const dates = [
    formatMonthYear(a.last_updated) && `Profile updated ${formatMonthYear(a.last_updated)}`,
    formatMonthYear(a.last_confirmed_at) && `confirmed ${formatMonthYear(a.last_confirmed_at)}`,
  ].filter(Boolean).join(' · ');

  return (
    // Narrow on purpose: this is a page of reading, and at the wide width a
    // quote ran to 115 characters a line.
    <div className="container container--narrow apage">
      <p className="crumb"><Link href="/directory">← All alumni</Link></p>

      {/* ── Who they are, and where they went ──────────────────────────
          The person leads. A campus photo used to open this page at 190px -
          the largest thing on a page about somebody else. It belongs on the
          college's own page. */}
      <header className="apage__head">
        <span
          className="avatar apage__avatar" aria-hidden
          style={{ '--tint': tintKey ? instituteTint(tintKey) : FALLBACK_TINT } as React.CSSProperties}
        >
          {a.show_photo && a.photo_url
            ? <img src={a.photo_url} alt="" width={128} height={128} />
            : initialsOf(a.full_name)}
        </span>
        <div className="apage__who">
          <h1 className="apage__name">{a.full_name}</h1>
          {strong && (
            <p className="apage__lead">
              {det?.logo_url && college && (
                <span className="apage__crest" aria-hidden><img src={det.logo_url} alt="" /></span>
              )}
              {a.college_id && college
                ? <Link href={`/colleges/${a.college_id}`}>{strong}</Link>
                : strong}
              {/* On the first screen, where a phone visitor will see it. The
                  score stays in the path below: the route is what says the
                  door exists. */}
              {facts.phrase && <span className="apage__via">via {facts.phrase}</span>}
            </p>
          )}
          {now && (
            <p className="apage__now"><span className="timeline__now">Now</span>{now}</p>
          )}
          <p className="apage__meta">
            {[
              a.class_of ? `Class of ${a.class_of}` : null,
              a.stream,
              shortSchoolName(a.school_name) || null,
            ].filter(Boolean).join(' · ')}
          </p>
          <div className="apage__actions">
            <ShareButton name={shortName(a.full_name)} />
            {a.linkedin_url && (
              <a className="btn btn--ghost" href={a.linkedin_url} target="_blank" rel="noopener noreferrer">
                <span className="btn__inner">LinkedIn ↗</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ── What they have to say ─────────────────────────────────────── */}
      {words.length > 0 && (
        <section className="apage__section">
          <h2>In their words</h2>
          <div className="apage__words">
            {words.map((w, i) => (
              <figure key={w.key}>
                {w.label && <figcaption className="apage__quote-label">{w.label}</figcaption>}
                <blockquote
                  className={`apage__quote${i === 0 && looksLikeWords(w.text) ? ' apage__quote--lead' : ''}`}
                >
                  {w.text}
                </blockquote>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* ── Their path ────────────────────────────────────────────────
          One timeline where there used to be four sections, several of which
          rendered a heading over a single line or over nothing. Every step
          here exists only because there is something to say in it. */}
      {pathIsWorthDrawing(steps) && (
        <section className="apage__section">
          <h2>Their path</h2>
          <ol className="timeline">
            {steps.map((st) => (
              <li
                key={st.key}
                className={`timeline__item timeline__item--${st.kind}${st.now ? ' timeline__item--now' : ''}`}
              >
                <span className="timeline__dot" aria-hidden>{st.icon}</span>
                <div className="timeline__body">
                  <div className="timeline__title">
                    {st.href ? <Link href={st.href}>{st.title}</Link> : st.title}
                    {st.now && <span className="timeline__now">Now</span>}
                  </div>
                  {st.sub && <div className="timeline__sub">{st.sub}</div>}
                  {st.meta && <div className="timeline__meta">{st.meta}</div>}
                  {st.aside && st.aside.items.length > 0 && (
                    <div className="timeline__aside">
                      {st.aside.label && <span className="timeline__aside-label">{st.aside.label}</span>}
                      <ul>
                        {st.aside.items.map((it) => (
                          <li key={it.key}>
                            {it.href ? <Link href={it.href}>{it.text}</Link> : it.text}
                            {it.meta && <span className="timeline__aside-meta"> · {it.meta}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {a.school_note && (
        <section className="apage__section apage__section--minor">
          <h2>A note from Veveaham</h2>
          <blockquote className="apage__quote apage__quote--school">{a.school_note}</blockquote>
        </section>
      )}

      {rails.length > 0 && (
        <section className="apage__section apage__section--minor apage__section--others">
          <h2>Others like them</h2>
          {rails.map((rail) => (
            <div key={rail.title} className="apage__rail">
              <div className="apage__rail-head">
                <h3 className="apage__band">
                  {rail.logo && <span className="apage__crest apage__crest--sm" aria-hidden><img src={rail.logo} alt="" /></span>}
                  {rail.title}
                </h3>
                <Link href={rail.href} className="link-btn">See all →</Link>
              </div>
              <div className="xcollege__seniors">
                {rail.people.map((p) => (
                  <Link key={p.id} href={profileHref(p)} className="senior-chip">
                    <span className="avatar avatar--xs" aria-hidden>
                      {p.show_photo && p.photo_url
                        ? <img src={p.photo_url} alt="" loading="lazy" decoding="async" width={34} height={34} />
                        : initialsOf(p.full_name)}
                    </span>
                    <span className="senior-chip__text">
                      <span className="senior-chip__name">{p.full_name}</span>
                      <span className="senior-chip__meta">
                        {[p.class_of ? `Class of ${p.class_of}` : null, p.degree].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {dates && <p className="apage__foot">{dates}</p>}

      <div className="apage__cta">
        <Link href="/register" className="btn btn--primary"><span className="btn__inner">Add your journey</span></Link>
        <Link href="/colleges" className="btn btn--ghost"><span className="btn__inner">All colleges</span></Link>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Person',
            name: a.full_name,
            alumniOf: [
              { '@type': 'EducationalOrganization', name: SCHOOL_GROUP_NAME },
              ...(college ? [{ '@type': 'CollegeOrUniversity', name: college }] : []),
            ],
            description: profileSummary(a),
            ...(a.linkedin_url ? { sameAs: [a.linkedin_url] } : {}),
          }),
        }}
      />
    </div>
  );
}
