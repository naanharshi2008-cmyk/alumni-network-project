import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchPathwaysData } from '../../lib/publicData';
import { buildPathways, pathwayCounts } from '../../lib/pathways';

/**
 * Pathways: every area seniors went into, and the ways into each.
 *
 * A junior asking "how do people get into engineering from our school?"
 * used to have to read profiles one at a time. This is the answer on one
 * page: board marks through TNEA, JEE Main, AMRITAEEE, a management seat -
 * with how many joined through each, how many more had an offer, and how many
 * more wrote the exam. Attempted is not admitted, and the page says so.
 *
 * Read with the anon key, from the public views: listed people only, bands
 * only. Preparing again is a count per area and never a name.
 */

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Pathways',
  description: 'The ways Veveaham seniors got into each area of study — the exams they wrote, the offers they had, and the seats they took.',
  alternates: { canonical: '/pathways' },
};

export default async function PathwaysPage() {
  const data = await fetchPathwaysData();
  const areas = buildPathways(data);

  return (
    <div className="container pathways">
      <header className="pathways__head">
        <h1>Pathways</h1>
        <p className="subtitle">
          Every area our seniors went into, and the ways in — how many joined through each, how many more had an
          offer, and how many more wrote the exam. Tap an area to see who.
        </p>
      </header>

      {areas.length === 0 && <p className="subtitle">Pathways appear here as seniors add where they went.</p>}

      <div className="pathways__grid">
        {areas.map((a) => (
          <Link key={a.key} href={`/pathways/${a.key}`} className="pathway-card" style={{ '--cat': a.accent } as React.CSSProperties}>
            <span className="pathway-card__head">
              <span className="pathway-card__emoji" aria-hidden>{a.emoji}</span>
              <span className="pathway-card__title">{a.label}</span>
              {a.people > 0 && <span className="pathway-card__count">{a.people} senior{a.people === 1 ? '' : 's'}</span>}
            </span>
            <span className="pathway-card__list">
              {a.pathways.slice(0, 5).map((p) => (
                <span key={p.key} className="pathway-card__line">
                  <span className="pathway-card__route">{p.label}</span>
                  <span className="pathway-card__nums">{pathwayCounts(p)}</span>
                </span>
              ))}
              {a.pathways.length > 5 && <span className="pathway-card__more">+ {a.pathways.length - 5} more</span>}
              {a.preparing && (
                <span className="pathway-card__line pathway-card__line--prep">
                  <span className="pathway-card__route">Preparing again</span>
                  <span className="pathway-card__nums">{a.preparing} this year</span>
                </span>
              )}
            </span>
            <span className="pathway-card__cta">See who →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
