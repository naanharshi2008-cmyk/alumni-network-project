'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { fetchApprovedAlumni } from '../../lib/publicData';
import { useDebounced } from '../../lib/useDebounced';
import { routeLabel } from '../../lib/admission';
import { buildSearchDoc, searchItems, type SearchDoc } from '../../lib/search';
import { instituteInitials, instituteTint, shortInstituteName } from '../../lib/showcase';
import { Alumnus, CollegeDetails, collegeDetailsOf, collegeKeyer, collegeNameOf } from '../../lib/types';

/* One screen of colleges at a time: the AISHE list our alumni draw from is
   long, and a grid that keeps growing is nobody's idea of browsing. */
const PAGE = 18;

type CollegeCard = {
  key: string;
  name: string;
  label: string;
  details: CollegeDetails | null;
  seniors: number;
  routes: string[];
  spellings: Set<string>;
  doc?: SearchDoc;
};

/**
 * Every college our approved alumni attend, one card each.
 *
 * Built from the alumni, not from the 47,000-row college list: these are the
 * places Veveaham students actually got into. Linked profiles group by college
 * id, so "IIT Madras" typed by one person and picked by another is one card.
 * Each card opens the directory's College view already searched for it.
 */
export default function CollegesPage() {
  const [rows, setRows] = useState<Alumnus[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const settled = useDebounced(query);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await fetchApprovedAlumni();
      if (cancelled) return;
      setError(err);
      setRows(data);
    })();
    return () => { cancelled = true; };
  }, []);

  const colleges = useMemo(() => (rows ? buildColleges(rows) : []), [rows]);
  const { results, closeMatches } = useMemo(
    () => searchItems(colleges, (c) => c.doc!, settled),
    [colleges, settled],
  );
  const seniorsShown = useMemo(() => results.reduce((n, c) => n + c.seniors, 0), [results]);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { setShown(PAGE); }, [settled]);

  // The directory has kept its view in the URL for a while; this page did not,
  // so searching for a college, opening it and pressing Back landed you on an
  // unsearched grid at the top - and /colleges?q=vellore was not even a link
  // anyone could send. Read once on mount, then mirrored with replaceState so
  // Back leaves the page rather than rewinding a word letter by letter.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) setQuery(q);
    const show = Number(params.get('show'));
    if (show > PAGE) setShown(Math.min(show, 200));
  }, []);

  const urlReady = useRef(false);
  useEffect(() => {
    if (!urlReady.current) { urlReady.current = true; return; }
    const url = new URL(window.location.href);
    if (settled.trim()) url.searchParams.set('q', settled.trim());
    else url.searchParams.delete('q');
    if (shown > PAGE) url.searchParams.set('show', String(shown));
    else url.searchParams.delete('show');
    window.history.replaceState(window.history.state, '', url);
  }, [settled, shown]);

  // Logos used to need a second query against the colleges table, because the
  // public view did not carry them. Migration 17 put logo_url in the view, so
  // they arrive with everything else - and a tile no longer pops its logo in a
  // moment after the grid has drawn.

  return (
    <div className="container container--wide">
      <div className="fade-up">
        <h1>Colleges our seniors joined</h1>
        <p className="subtitle">
          Every college here has at least one Veveaham senior in it. Open one to meet them and see how they got in.
        </p>
      </div>

      <div className="search colleges-search fade-up" style={{ animationDelay: '0.04s' }}>
        <svg className="search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          placeholder="Search a college — “IITM”, “Anna Univ”, “CMC Vellore”…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search colleges"
        />
      </div>

      {rows === null ? (
        <div className="college-grid">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 250 }} />)}
        </div>
      ) : !isSupabaseConfigured ? (
        <div className="alert alert--error">The directory isn&apos;t connected yet.</div>
      ) : error ? (
        <div className="alert alert--error">Couldn&apos;t load colleges: {error}</div>
      ) : colleges.length === 0 ? (
        <div className="empty">
          <span className="empty__emoji">🏛️</span>
          <h2>No colleges yet</h2>
          <p>They appear here as seniors add their journeys.</p>
        </div>
      ) : (
        <>
          <p className="result-count" role="status" style={{ margin: '4px 0 14px' }}>
            {results.length === colleges.length
              ? `${colleges.length} ${colleges.length === 1 ? 'college' : 'colleges'}`
              : `${results.length} of ${colleges.length} colleges`}
            {seniorsShown > 0 && ` · ${seniorsShown} ${seniorsShown === 1 ? 'senior' : 'seniors'}`}
            {closeMatches && ` · close matches for “${settled.trim()}”`}
          </p>
          {results.length === 0 ? (
            <div className="empty">
              <span className="empty__emoji">🔍</span>
              <h2>No college matches “{query.trim()}”</h2>
              <p>
                None of our seniors are there yet — or it goes by another name.{' '}
                <Link href="/register" style={{ color: 'var(--gold)' }}>Studying there? Add your journey →</Link>
              </p>
            </div>
          ) : (
            <>
              <div className="college-grid stagger">
                {results.slice(0, shown).map((c) => (
                  <CollegeTile key={c.key} college={c} />
                ))}
              </div>
              {results.length > shown && (
                <button type="button" className="show-more" onClick={() => setShown((n) => n + PAGE)}>
                  Show {Math.min(PAGE, results.length - shown)} more{' '}
                  {Math.min(PAGE, results.length - shown) === 1 ? 'college' : 'colleges'}{' '}
                  <span className="show-more__of">of {results.length}</span>
                </button>
              )}
            </>
          )}
        </>
      )}

      <p className="lens-note" style={{ marginTop: 34 }}>
        Don&apos;t see your college? <Link href="/register" className="link-btn">Add your journey</Link> and it
        appears here once the school approves your profile.
      </p>
    </div>
  );
}

/** The linked college's id, when this group is a real row rather than typed text. */
function collegeIdOf(c: CollegeCard): string | null {
  return c.key.startsWith('id:') ? c.key.slice(3) : null;
}

function CollegeTile({ college: c }: { college: CollegeCard }) {
  const logo = c.details?.logo_url ?? null;
  const place = [c.details?.district, c.details?.state].filter(Boolean).join(', ');
  const id = collegeIdOf(c);
  // A college we have a row for gets its own page, with photos and the seniors
  // there. One that only exists as typed text still goes to the directory.
  const href = id ? `/colleges/${id}` : `/directory?lens=college&q=${encodeURIComponent(c.label)}`;
  return (
    <Link href={href} className="college-tile">
      <span
        className="college-tile__banner" aria-hidden
        style={{ '--tint': instituteTint(c.key) } as React.CSSProperties}
      >
        {c.details?.banner_url
          ? <img src={c.details.banner_url} alt="" loading="lazy" decoding="async" />
          : <span className="college-tile__initials">{instituteInitials(c.label)}</span>}
        {logo && <span className="college-tile__logo"><img src={logo} alt="" loading="lazy" /></span>}
      </span>
      <span className="college-tile__body">
        <h2 className="college-tile__name">{c.name}</h2>
        {c.label !== c.name && <span className="college-tile__alias">{c.label}</span>}
        {place && <span className="college-tile__place">{place}</span>}
        {c.routes.length > 0 && (
          <span className="college-tile__routes">
            {c.routes.map((r) => <span key={r} className="college-tile__route">{r}</span>)}
          </span>
        )}
        <span className="college-tile__foot">
          <span>{c.seniors} {c.seniors === 1 ? 'senior' : 'seniors'}</span>
          <span aria-hidden>→</span>
        </span>
      </span>
    </Link>
  );
}

function buildColleges(alumni: Alumnus[]): CollegeCard[] {
  const keyOf = collegeKeyer(alumni);
  const map = new Map<string, CollegeCard & { routeCounts: Map<string, number> }>();
  for (const a of alumni) {
    const key = keyOf(a);
    const typed = a.college_name_raw?.trim();
    const name = collegeNameOf(a) ?? typed;
    if (!key || !name) continue;
    let entry = map.get(key);
    if (!entry) {
      entry = { key, name, label: name, details: null, seniors: 0, routes: [], spellings: new Set(), routeCounts: new Map() };
      map.set(key, entry);
    }
    const details = collegeDetailsOf(a);
    // A linked college carries its official name, banner and aliases; prefer it
    // over a typed spelling that happened to come first.
    if (details && !entry.details) {
      entry.details = details;
      entry.name = collegeNameOf(a) ?? entry.name;
    }
    if (typed) entry.spellings.add(typed);
    entry.seniors += 1;
    const route = routeLabel(a);
    if (route) entry.routeCounts.set(route, (entry.routeCounts.get(route) ?? 0) + 1);
  }

  return [...map.values()]
    .map(({ routeCounts, ...c }) => {
      const aliases = c.details?.aliases ?? [];
      return {
        ...c,
        label: shortInstituteName(c.name, aliases),
        routes: [...routeCounts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([r]) => r),
        doc: buildSearchDoc({
          people: [],
          institutes: [c.name, ...aliases, ...c.spellings],
          other: [c.details?.district, c.details?.state, c.details?.university_name, ...routeCounts.keys()],
        }),
      };
    })
    .sort((x, y) => y.seniors - x.seniors || x.name.localeCompare(y.name));
}
