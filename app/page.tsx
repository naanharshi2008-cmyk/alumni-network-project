import Link from 'next/link';
import { CATEGORIES } from '../lib/types';
import ShowcaseSection from './ShowcaseSection';

export default function Home() {
  return (
    <main className="container">
      <section className="hero fade-up">
        <span className="hero__eyebrow">🎓 Alumni network · one tap to explore</span>
        <h1 className="hero__title">
          Where our seniors are,
          <br />
          <span className="hero__grad">and what they do now.</span>
        </h1>
        <p className="hero__sub">
          Browse where alumni studied, what they went on to do, and the advice
          they left behind, then add your own journey in under two minutes.
        </p>
        <div className="hero__cta">
          <Link href="/directory" className="btn btn--primary btn--lg">
            <span className="btn__inner">Browse the directory →</span>
          </Link>
          <Link href="/register" className="btn btn--ghost btn--lg">
            <span className="btn__inner">Add yourself</span>
          </Link>
        </div>

        <div className="chips stagger" style={{ justifyContent: 'center', marginTop: 40, maxWidth: 560, marginInline: 'auto' }}>
          {CATEGORIES.filter((c) => c.key !== 'other').map((c) => (
            <span key={c.key} className="chip" style={{ cursor: 'default' }}>
              <span className="chip__emoji">{c.emoji}</span>
              {c.label}
            </span>
          ))}
        </div>

        <div className="hero__glow" aria-hidden />
      </section>

      <ShowcaseSection />
    </main>
  );
}
