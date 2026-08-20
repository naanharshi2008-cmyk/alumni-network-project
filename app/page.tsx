'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alumnus } from '../lib/types';
import { fetchApprovedAlumni } from '../lib/publicData';
import HeroStats from './HeroStats';
import HomeGalleries from './HomeGalleries';

/**
 * Gallery-first landing page.
 *
 * No profiles here any more: the home page's job is to show a class-11 visitor
 * the SHAPE of what exists - areas, exam routes, states, with honest counts -
 * and hand them to the directory one tap later. (The old "Meet a few seniors"
 * showcase moved out in round 3; profiles live in the directory.)
 *
 * One fetch feeds the stats strip and all three galleries.
 */
export default function Home() {
  const router = useRouter();
  const [rows, setRows] = useState<Alumnus[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await fetchApprovedAlumni();
      if (!cancelled) setRows(data);
    })();
    return () => { cancelled = true; };
  }, []);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    router.push(q ? `/directory?q=${encodeURIComponent(q)}` : '/directory');
  }

  return (
    <main className="container">
      <section className="hero fade-up">
        <span className="hero__eyebrow">🎓 Veveaham alumni · real paths, real ranks</span>
        <h1 className="hero__title">
          Where our seniors are,
          <br />
          <span className="hero__grad">and how they got there.</span>
        </h1>
        <p className="hero__sub">
          See which colleges seniors from your school got into, the exam or marks
          they got in with, and what they would tell you to do differently.
        </p>
        <div className="hero__cta">
          <Link href="/directory" className="btn btn--primary btn--lg">
            <span className="btn__inner">Browse the directory →</span>
          </Link>
          <Link href="/register" className="btn btn--ghost btn--lg">
            <span className="btn__inner">I&apos;m an alumnus</span>
          </Link>
        </div>

        {/* One search, straight into the directory: a college name, an exam,
            a person, a state - the haystack matches all of them. */}
        <form className="hero-search" onSubmit={submitSearch} role="search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Try “Anna University”, “NEET”, or a name…"
            aria-label="Search the alumni directory"
          />
          <button type="submit" className="btn btn--neutral">
            <span className="btn__inner">Search</span>
          </button>
        </form>

        <HeroStats alumni={rows} />

        <div className="hero__glow" aria-hidden />
      </section>

      <HomeGalleries alumni={rows} />
    </main>
  );
}
