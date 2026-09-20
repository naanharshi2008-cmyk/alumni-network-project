import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { fetchAlumnusBySlug, fetchRelatedAlumni, fetchTimelines } from '../../../lib/publicData';
import { AdmissionBadges, Fact, Row } from '../../../lib/profileParts';
import { boardForSchool, officialSchoolName } from '../../../lib/options';
import {
  collegeLabel, collegeTintKey, instituteInitials, instituteTint, profileHref, profileSummary, shortName,
} from '../../../lib/showcase';
import {
  Alumnus, SCHOOL_GROUP_NAME, collegeDetailsOf, initialsOf, professionalLabel,
  sortHigherStudies, sortWorkExperience, yearRange,
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

  const [timelines, rails] = await Promise.all([
    fetchTimelines([person.id as string]),
    fetchRelatedAlumni(person),
  ]);
  const studies = sortHigherStudies(timelines.studies[person.id as string] ?? []);
  const work = sortWorkExperience(timelines.work[person.id as string] ?? []);

  const a = person;
  const det = collegeDetailsOf(a);
  const college = collegeLabel(a);
  const tint = collegeTintKey(a);
  const dept = [a.degree, a.branch].filter(Boolean).join(' · ');
  const now = [a.currently_at, a.designation].filter(Boolean).join(' · ');
  const board = boardForSchool(a.school_name);

  return (
    <div className="container container--wide">
      <p className="crumb"><Link href="/directory">← All alumni</Link></p>

      <header className="apage__head">
        <div
          className="apage__banner"
          style={tint ? ({ '--tint': instituteTint(tint) } as React.CSSProperties) : undefined}
        >
          {det?.banner_url && <img src={det.banner_url} alt="" />}
        </div>

        <div className="apage__intro">
          <span className="avatar apage__avatar" aria-hidden>
            {a.show_photo && a.photo_url
              ? <img src={a.photo_url} alt="" width={96} height={96} />
              : initialsOf(a.full_name)}
          </span>
          <div className="apage__who">
            <h1 className="apage__name">{a.full_name}</h1>
            <p className="apage__meta">
              {[
                a.class_of ? `Class of ${a.class_of}` : null,
                a.stream,
                officialSchoolName(a.school_name) || null,
              ].filter(Boolean).join(' · ')}
              {board && <span className="apage__board"> · {board}</span>}
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
        </div>
      </header>

      <section className="apage__section">
        <h2>How they got in</h2>
        <AdmissionBadges a={a} />
        {a.board_cutoff && <p className="modal-note">Cutoff {a.board_cutoff}</p>}
        {!a.admission_route && !a.admission_rank && !a.board_marks && (
          <p className="lens-note">They haven&apos;t said yet.</p>
        )}
      </section>

      {(a.message_1 || a.message_2) && (
        <section className="apage__section">
          <h2>What they would tell a junior</h2>
          {a.message_1 && <blockquote className="apage__quote">{a.message_1}</blockquote>}
          {a.message_2 && <blockquote className="apage__quote">{a.message_2}</blockquote>}
        </section>
      )}

      {a.school_note && (
        <section className="apage__section">
          <h2>A note from Veveaham</h2>
          <blockquote className="apage__quote apage__quote--school">{a.school_note}</blockquote>
        </section>
      )}

      <section className="apage__section">
        <h2>Where they studied</h2>
        <div className="a-card__rows">
          <Row icon="🏫" label="School">
            {officialSchoolName(a.school_name) || '—'}
            {board && <span style={{ color: 'var(--text-faint)' }}> · {board}</span>}
          </Row>
          {college && (
            <Row icon="🏛️" label="College">
              {a.college_id
                ? <Link className="a-link" href={`/colleges/${a.college_id}`}>{college}</Link>
                : college}
              {det?.state ? ` · ${det.state}` : ''}
            </Row>
          )}
          {dept && <Row icon="🎓" label="Studied">{dept}</Row>}
          {professionalLabel(a) && (
            <Row icon="📜" label={a.degree ? 'Also pursuing' : 'Pursuing'}>
              {professionalLabel(a)}
              {a.professional_org && (
                <span style={{ color: 'var(--text-faint)' }}> · at {a.professional_org}</span>
              )}
            </Row>
          )}
          {a.expected_finish_year && <Row icon="📅" label="Expected to finish">{a.expected_finish_year}</Row>}
        </div>

        {det && (det.description || a.college_thoughts || det.website || det.university_name) && (
          <div className="apage__college">
            {det.description && <p className="college-desc">{det.description}</p>}
            {a.college_thoughts && (
              <blockquote className="apage__quote">In their words: &ldquo;{a.college_thoughts}&rdquo;</blockquote>
            )}
            <div className="college-facts">
              <div className="college-facts__grid">
                {det.university_name && det.university_name !== college && (
                  <Fact label="University" value={det.university_name} />
                )}
                {det.management_type && <Fact label="Management" value={det.management_type} />}
                {det.established_year && <Fact label="Established" value={String(det.established_year)} />}
                {det.district && (
                  <Fact label="Location" value={[det.district, det.state].filter(Boolean).join(', ')} />
                )}
              </div>
              <div className="apage__college-links">
                {a.college_id && (
                  <Link href={`/colleges/${a.college_id}`} className="btn btn--primary" style={{ fontSize: '0.85rem' }}>
                    <span className="btn__inner">See this college and everyone from Veveaham there →</span>
                  </Link>
                )}
                {det.website && (
                  <a
                    href={det.website.startsWith('http') ? det.website : `https://${det.website}`}
                    target="_blank" rel="noopener noreferrer" className="btn btn--ghost"
                    style={{ fontSize: '0.85rem' }}
                  >
                    <span className="btn__inner">Their own website ↗</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {(studies.length > 0 || work.length > 0) && (
        <section className="apage__section">
          <h2>Their journey since</h2>
          {studies.length > 0 && (
            <>
              <h3 className="apage__band">Studies</h3>
              <ol className="timeline">
                {studies.map((s) => (
                  <li key={s.id} className="timeline__item">
                    <span className="timeline__dot" aria-hidden>🎓</span>
                    <div>
                      <div className="timeline__title">{s.degree_name}</div>
                      {s.institution && <div className="timeline__sub">{s.institution}</div>}
                      {yearRange(s.start_year, s.finish_year) && (
                        <div className="timeline__years">{yearRange(s.start_year, s.finish_year)}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
          {work.length > 0 && (
            <>
              <h3 className="apage__band">Work</h3>
              <ol className="timeline">
                {work.map((w) => (
                  <li key={w.id} className="timeline__item">
                    <span className="timeline__dot" aria-hidden>💼</span>
                    <div>
                      <div className="timeline__title">
                        {w.role ? `${w.role} · ` : ''}{w.company}
                        {w.is_current && <span className="timeline__now">Present</span>}
                      </div>
                      {yearRange(w.start_year, w.end_year, w.is_current) && (
                        <div className="timeline__years">{yearRange(w.start_year, w.end_year, w.is_current)}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      <section className="apage__section">
        <h2>Right now</h2>
        <div className="a-card__rows">
          <Row icon="📌" label="Status">{a.current_status ?? 'Alumnus'}</Row>
          {now && <Row icon="💼" label="At">{now}</Row>}
        </div>
      </section>

      {rails.length > 0 && (
        <section className="apage__section">
          <h2>Others like them</h2>
          {rails.map((rail) => (
            <div key={rail.title} className="apage__rail">
              <div className="apage__rail-head">
                <h3 className="apage__band">{rail.title}</h3>
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

      <p className="apage__foot">
        {a.last_updated && `Profile updated ${new Date(a.last_updated).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`}
        {a.last_confirmed_at && ` · confirmed ${new Date(a.last_confirmed_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`}
      </p>

      <div className="apage__cta">
        <Link href="/directory" className="btn btn--ghost"><span className="btn__inner">All alumni</span></Link>
        <Link href="/colleges" className="btn btn--ghost"><span className="btn__inner">All colleges</span></Link>
        <Link href="/register" className="btn btn--primary"><span className="btn__inner">Add your journey</span></Link>
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
