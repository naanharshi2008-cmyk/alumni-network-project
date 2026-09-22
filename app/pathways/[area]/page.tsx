import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchPathwaysData } from '../../../lib/publicData';
import { buildPathways, pathwayCounts, type Pathway, type PathwayPerson } from '../../../lib/pathways';
import { CATEGORIES, initialsOf } from '../../../lib/types';

/**
 * One area: each way in, and the seniors behind it, in three bands - who
 * joined through it, who else had an offer, who else wrote it. A person sits
 * in the strongest band they reached (see lib/pathways.ts).
 */

export const revalidate = 3600;

type Props = { params: Promise<{ area: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { area } = await params;
  const cat = CATEGORIES.find((c) => c.key === area);
  if (!cat) return { title: 'Pathway not found', robots: { index: false } };
  return {
    title: `${cat.label} — pathways`,
    description: `How Veveaham seniors got into ${cat.label.toLowerCase()}: the exams they wrote, the offers they had and the seats they took.`,
    alternates: { canonical: `/pathways/${cat.key}` },
  };
}

function Chips({ people }: { people: PathwayPerson[] }) {
  return (
    <div className="xcollege__seniors">
      {people.map((p) => (
        <Link key={p.id} href={p.slug ? `/alumni/${encodeURIComponent(p.slug)}` : '/directory'} className="senior-chip">
          <span className="avatar avatar--xs" aria-hidden>
            {p.photo ? <img src={p.photo} alt="" loading="lazy" decoding="async" width={34} height={34} /> : initialsOf(p.name)}
          </span>
          <span className="senior-chip__text">
            <span className="senior-chip__name">{p.name}</span>
            <span className="senior-chip__meta">{[p.classOf ? `Class of ${p.classOf}` : null, p.where].filter(Boolean).join(' · ')}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function PathwayBlock({ p }: { p: Pathway }) {
  return (
    <section className="pathway" id={p.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}>
      <h2 className="pathway__title">{p.label}</h2>
      <p className="pathway__nums">{pathwayCounts(p)}</p>
      {p.joined.length > 0 && (
        <div className="pathway__band">
          <h3 className="pathway__band-title">{p.kind === 'exam' ? 'Joined through it' : 'Joined this way'}</h3>
          <Chips people={p.joined} />
        </div>
      )}
      {p.offered.length > 0 && (
        <div className="pathway__band">
          <h3 className="pathway__band-title">{p.joined.length ? 'Also had an offer through it' : 'Had an offer through it'}</h3>
          <Chips people={p.offered} />
        </div>
      )}
      {p.wrote.length > 0 && (
        <div className="pathway__band">
          <h3 className="pathway__band-title">{p.joined.length || p.offered.length ? 'Also wrote it' : 'Wrote it'}</h3>
          <Chips people={p.wrote} />
        </div>
      )}
    </section>
  );
}

export default async function AreaPathwaysPage({ params }: Props) {
  const { area } = await params;
  const cat = CATEGORIES.find((c) => c.key === area);
  if (!cat) notFound();
  const found = buildPathways(await fetchPathwaysData()).find((a) => a.key === cat.key);

  return (
    <div className="container container--narrow pathways">
      <p className="crumb"><Link href="/pathways">← All pathways</Link></p>
      <header className="pathways__head">
        <h1><span aria-hidden>{cat.emoji}</span> {cat.label}</h1>
        <p className="subtitle">
          {found?.people
            ? `${found.people} senior${found.people === 1 ? '' : 's'} from our schools study ${cat.label.toLowerCase()}. These are the ways they got in, and the exams others wrote on the way.`
            : `The ways seniors from our schools have tried for ${cat.label.toLowerCase()} so far.`}
        </p>
      </header>

      {!found || found.pathways.length === 0 ? (
        <p className="subtitle">Nobody has added a path into {cat.label.toLowerCase()} yet. <Link href="/register">Add yours</Link>.</p>
      ) : (
        <>
          <nav className="chips pathways__jump" aria-label="Pathways in this area">
            {found.pathways.map((p) => (
              <a key={p.key} className="chip" href={`#${p.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>{p.label}</a>
            ))}
          </nav>
          {found.pathways.map((p) => <PathwayBlock key={p.key} p={p} />)}
        </>
      )}

      {found?.preparing && (
        <section className="pathway pathway--prep">
          <h2 className="pathway__title">Preparing again</h2>
          <p className="pathway__nums">
            {found.preparing} are taking this year to prepare. Their pages stay private until they say where they
            joined — then the year shows on their path, like any other step.
          </p>
        </section>
      )}

      <div className="apage__cta">
        <Link href="/register" className="btn btn--primary"><span className="btn__inner">Add your path</span></Link>
        <Link href="/directory" className="btn btn--ghost"><span className="btn__inner">All alumni</span></Link>
      </div>
    </div>
  );
}
