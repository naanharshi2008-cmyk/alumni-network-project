'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alumnus, HigherStudy } from '../lib/types';
import { fetchApprovedAlumni, fetchTimelines } from '../lib/publicData';
import {
  featuredLineup, heroFaces, popularSearches, quoteCandidates, rotationWindow,
} from '../lib/showcase';
import HeroCollage from './HeroCollage';
import FeaturedAlumni from './FeaturedAlumni';
import HomeStats from './HomeStats';
import HomeGalleries from './HomeGalleries';
import { useViewer } from './Viewer';

const FEATURED_COUNT = 4;
// The hero shows four at a time and rotates through the rest of this pool.
const HERO_POOL = 12;

/**
 * The landing page: who our seniors are, shown with their own faces and words.
 *
 * One fetch feeds everything. Every card, quote, chip and number comes from an
 * approved profile; with fewer profiles the page shows less, never filler.
 * Rotation is by a 3-hour window computed after the data arrives, so the page
 * renders the same for everyone in that window and never flickers on reload.
 */
export default function Home() {
  const router = useRouter();
  const who = useViewer();
  const [rows, setRows] = useState<Alumnus[] | null>(null);
  const [error, setError] = useState('');
  const [studies, setStudies] = useState<Record<string, HigherStudy[]>>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await fetchApprovedAlumni();
      if (cancelled) return;
      // Every other public page reports this. The home page used to discard
      // it, so a failed fetch rendered the hero and nothing else, for ever,
      // with nothing to say why.
      setError(err);
      setRows(data);
    })();
    return () => { cancelled = true; };
  }, []);

  const showcase = useMemo(() => {
    if (!rows) return null;
    const slot = rotationWindow();
    const lineup = featuredLineup(rows, slot);
    const featured = lineup.slice(0, FEATURED_COUNT);
    return {
      featured,
      faces: heroFaces(lineup, featured.length, HERO_POOL),
      quotes: quoteCandidates(rows, slot),
      popular: popularSearches(rows),
    };
  }, [rows]);

  // Second courses, for the people actually on screen: a card can then say both
  // where someone did their degree and where they went afterwards.
  useEffect(() => {
    if (!showcase) return undefined;
    const ids = [...new Set(
      [...showcase.faces, ...showcase.quotes.map((q) => q.person)]
        .map((a) => a.id)
        .filter((id): id is string => !!id),
    )];
    if (ids.length === 0) return undefined;
    let cancelled = false;
    (async () => {
      const t = await fetchTimelines(ids);
      if (!cancelled) setStudies(t.studies);
    })();
    return () => { cancelled = true; };
  }, [showcase]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    router.push(q ? `/directory?q=${encodeURIComponent(q)}` : '/directory');
  }

  return (
    <div className="container container--wide">
      <section className="hero2">
        <div className="hero2__text fade-up">
          <span className="hero__eyebrow">
            <img className="hero__eyebrow-crest" src="/brand/crest-96.png" alt="" width={96} height={96} />
            Veveaham alumni · where our seniors went next
          </span>
          <h1 className="hero2__title">
            Where our seniors are,
            <br />
            <span className="hero__grad">and how they got there.</span>
          </h1>
          {/* Where they went, not what they scored. This line used to lead
              with the exam or marks they got in with, and the eyebrow promised
              ranks - which put a number in front of every junior before a
              single senior. The routes are still on every card. */}
          <p className="hero2__sub">
            See the colleges and courses seniors from your school went on to, how
            they got there, and what they say about it.
          </p>
          <div className="hero2__cta">
            <Link href="/directory" className="btn btn--primary btn--lg">
              <span className="btn__inner">Explore alumni →</span>
            </Link>
            <AlumnusDoor who={who} />
          </div>

          {/* One search, straight into the directory. It understands college
              aliases and forgives typos, so "IITM" and "Anna Univesity" work. */}
          <form className="pill-search" onSubmit={submitSearch} role="search">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Try “Anna University”, “NEET”, or a name…"
              aria-label="Search the alumni directory"
              enterKeyHint="search"
            />
            <button type="submit" className="pill-search__go" aria-label="Search">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
            </button>
          </form>

          {showcase && showcase.popular.length > 0 && (
            <div className="popular">
              <span className="popular__label">Popular searches:</span>
              {showcase.popular.map((p) => (
                <Link key={p.label} href={p.href} className="popular__chip">
                  {p.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        <HeroCollage faces={showcase?.faces ?? null} quotes={showcase?.quotes ?? []} studies={studies} />
        <div className="hero__glow" aria-hidden />
      </section>

      {error && (
        <div className="alert alert--error" role="alert">
          Couldn&apos;t load alumni: {error}
        </div>
      )}

      {showcase && <FeaturedAlumni people={showcase.featured} />}
      {rows && <HomeStats alumni={rows} />}
      <HomeGalleries alumni={rows} />
    </div>
  );
}

/**
 * The hero's second button: the way in for someone who studied here.
 *
 * It used to go straight to registration, which is the wrong door for anyone
 * who already has an account - including every alumnus the school set up a
 * login for. Sign-in is the door for both, and it offers "create your account"
 * to anyone who turns out not to have one. Once signed in, the button stops
 * being a question and becomes the thing they would click it for.
 *
 * While the session is still resolving it renders the guest button hidden, so
 * the hero keeps its width and does not jump when the answer arrives - the
 * same reason the nav and footer hold a placeholder.
 */
function AlumnusDoor({ who }: { who: ReturnType<typeof useViewer> }) {
  const door =
    who === 'alumnus' ? { href: '/profile', label: 'My profile' }
      : who === 'admin' ? { href: '/admin', label: 'Dashboard' }
        : { href: '/login', label: 'I’m an alumnus' };
  return (
    <Link
      href={door.href}
      className="btn btn--ghost btn--lg"
      style={who === 'unknown' ? { visibility: 'hidden' } : undefined}
      aria-hidden={who === 'unknown' || undefined}
      tabIndex={who === 'unknown' ? -1 : undefined}
    >
      <span className="btn__inner">{door.label}</span>
    </Link>
  );
}
