import Link from 'next/link';
import { CATEGORIES } from '../lib/types';
import ShowcaseSection from './ShowcaseSection';
import HeroStats from './HeroStats';

export default function Home() {
  return (
    <main className="container">
      <section className="hero fade-up">
        <span className="hero__eyebrow">🎓 Veveaham alumni · real paths, real ranks</span>
        <h1 className="hero__title">
          Where our seniors are,
          <br />
          <span className="hero__grad">and how they got there.</span>
        </h1>
        {/* Written for the people this site is actually for: class 11-12
            students and their parents. The old copy ended on "add your own
            journey in under two minutes" - which addresses alumni, a group who
            cannot use most of this page, and promised a form time the five-step
            form was never going to keep. */}
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

        <HeroStats />

        {/* These were decorative spans with cursor:default, sitting in the most
            valuable slot on the page doing nothing. A student who taps
            "Medicine" and lands on the two doctors is the whole product in one
            gesture, so they are links now. */}
        <div className="chips stagger" style={{ justifyContent: 'center', marginTop: 34, maxWidth: 620, marginInline: 'auto' }}>
          {CATEGORIES.filter((c) => c.key !== 'other').map((c) => (
            <Link
              key={c.key}
              href={`/directory?cat=${c.key}`}
              className="chip chip--cat"
              style={{ '--cat': c.accent } as React.CSSProperties}
            >
              <span className="chip__emoji">{c.emoji}</span>
              {c.label}
            </Link>
          ))}
        </div>

        <div className="hero__glow" aria-hidden />
      </section>

      <ShowcaseSection />
    </main>
  );
}
