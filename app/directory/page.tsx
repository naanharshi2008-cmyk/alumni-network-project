'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { fetchApprovedAlumni, fetchTimelines } from '../../lib/publicData';
import { boardForSchool, officialSchoolName, publicRouteLabel, SCHOOLS } from '../../lib/options';
import { AdmissionBadges, Fact, Row } from '../../lib/profileParts';
import { formatRankBand, formatMarksBand, formatRankSpan, formatMonthYear } from '../../lib/text';
import { buildSearchDoc, searchItems, type SearchDoc } from '../../lib/search';
import { collegeTintKey, instituteInitials, instituteTint } from '../../lib/showcase';
import {
  Alumnus,
  CATEGORIES,
  CollegeDetails,
  HigherStudy,
  WorkExperience,
  categorize,
  collegeKeyer,
  collegeNameOf,
  collegeDetailsOf,
  initialsOf,
  professionalLabel,
  sortHigherStudies,
  sortWorkExperience,
  yearRange,
} from '../../lib/types';

type EnrichedAlumnus = { a: Alumnus; cat: ReturnType<typeof categorize> };

/* How much of a long directory to render at once.
   The directory is meant to be read, not scrolled past: a batch of forty
   seniors rendered in full is a wall, and every card pulls a photo. So a group
   shows a dozen and offers the rest, and only the newest batches start open -
   older ones are a line you can click, which is also how a visitor finds "my
   brother's year" without scrolling through everyone else's. */
const PAGE = 12;
const OPEN_GROUPS = 2;
const COLLEGE_PAGE = 8;
const SENIOR_PREVIEW = 6;
type Timelines = { studies: Record<string, HigherStudy[]>; work: Record<string, WorkExperience[]> };

/* ── Batch/year grouping helpers ─────────────────────────────────────────── */
// Schools render in the official order, with anything unrecognised last.
function schoolRank(name: string | null): number {
  const idx = (SCHOOLS as readonly string[]).indexOf(officialSchoolName(name));
  return idx === -1 ? SCHOOLS.length : idx;
}

function groupByYear(items: EnrichedAlumnus[]): Map<number | null, EnrichedAlumnus[]> {
  const map = new Map<number | null, EnrichedAlumnus[]>();
  for (const item of items) {
    const yr = item.a.class_of;
    if (!map.has(yr)) map.set(yr, []);
    map.get(yr)!.push(item);
  }
  return new Map([...map.entries()].sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0)));
}

// Within a year, split further by school so the directory reads
// "Class of 2024 -> Girls -> [cards] -> Prime Academy -> [cards]".
function groupBySchool(items: EnrichedAlumnus[]): [string, EnrichedAlumnus[]][] {
  const map = new Map<string, EnrichedAlumnus[]>();
  for (const item of items) {
    const school = officialSchoolName(item.a.school_name) || 'Other';
    if (!map.has(school)) map.set(school, []);
    map.get(school)!.push(item);
  }
  return [...map.entries()].sort((a, b) => schoolRank(a[0]) - schoolRank(b[0]));
}

/* ── College Explorer model ─────────────────────────────────────────────── */
// The Explorer used to fetch the whole `colleges` table (47,000 rows, silently
// truncated at 1,000 by PostgREST) and show colleges nobody from the school had
// ever attended. It is far more useful - and far cheaper - to derive the list
// from the alumni themselves: these are the places Veveaham students actually
// got into, which is the question a class 11/12 student is really asking.
type ExplorerCollege = {
  key: string;
  name: string;
  details: CollegeDetails | null;
  seniors: Alumnus[];
};

// Grouped by college id, not by spelling: "IIT Madras" and "IITM" are one card.
function buildExplorerColleges(items: EnrichedAlumnus[]): ExplorerCollege[] {
  const map = new Map<string, ExplorerCollege>();
  const keyOf = collegeKeyer(items.map(({ a }) => a));
  for (const { a } of items) {
    const name = collegeNameOf(a) ?? a.college_name_raw;
    const key = keyOf(a);
    if (!name?.trim() || !key) continue;
    let entry = map.get(key);
    if (!entry) {
      entry = { key, name: name.trim(), details: collegeDetailsOf(a), seniors: [] };
      map.set(key, entry);
    }
    // A matched college row carries its official name, state, banner; prefer it
    // over a typed spelling that happened to come first.
    if (!entry.details && collegeDetailsOf(a)) {
      entry.details = collegeDetailsOf(a);
      entry.name = collegeNameOf(a) ?? entry.name;
    }
    entry.seniors.push(a);
  }
  return [...map.values()].sort(
    (x, y) => y.seniors.length - x.seniors.length || x.name.localeCompare(y.name),
  );
}

/* ── Share links ──────────────────────────────────────────────────────────── */
function shareParam(a: Alumnus): string | null {
  return a.public_slug || a.username || null;
}
function findByShareParam(items: EnrichedAlumnus[], param: string): EnrichedAlumnus | undefined {
  const p = param.toLowerCase();
  return items.find(({ a }) => (a.public_slug ?? '').toLowerCase() === p)
    ?? items.find(({ a }) => (a.username ?? '').toLowerCase() === p);
}

/* ── Filters and lenses ──────────────────────────────────────────────────
   One set of alumni, sliced four ways.

   The directory used to offer a single dimension (study area) plus a separate
   College Explorer tab with its own search and its own mental model. A
   question as ordinary as "engineering seniors from 2024 who took TNEA" could
   not be asked. So filters are now combinable and the tabs became LENSES over
   the same filtered set - the Explorer is the College lens, not another page.

   State is deliberately NOT a dimension: it is known for only 5 of 19 rows
   (most matched colleges carry no state), so it would hide more than it
   reveals. It stays searchable through the haystack instead.
─────────────────────────────────────────────────────────────────────────── */
type Lens = 'batch' | 'college' | 'route' | 'area';
type FilterKey = 'cat' | 'batch' | 'route' | 'status';
type Filters = Record<FilterKey, string>;

const LENSES: { key: Lens; label: string; emoji: string }[] = [
  { key: 'batch', label: 'Batch', emoji: '🎓' },
  { key: 'college', label: 'College', emoji: '🏛️' },
  { key: 'route', label: 'How they got in', emoji: '📝' },
  { key: 'area', label: 'Area', emoji: '🧭' },
];

const FILTER_KEYS: FilterKey[] = ['cat', 'batch', 'route', 'status'];
const FILTER_LABELS: Record<FilterKey, string> = {
  cat: 'Area', batch: 'Batch', route: 'How they got in', status: 'Doing now',
};
const NO_FILTERS: Filters = { cat: '', batch: '', route: '', status: '' };

// The value each alumnus takes on a filter dimension. '' means "not recorded",
// which is never offered as a filter option - you cannot usefully ask for the
// people whose route nobody wrote down.
function facetValue({ a, cat }: EnrichedAlumnus, key: FilterKey): string {
  switch (key) {
    case 'cat': return cat.key;
    case 'batch': return a.class_of ? String(a.class_of) : '';
    case 'route': return publicRouteLabel(a.admission_route) ?? '';
    case 'status': return a.current_status ?? '';
  }
}

// `except` is what makes the counts honest: when counting the options of one
// dimension, that dimension's own selection must be ignored, or every
// unselected option would read 0.
function matchesFilters(item: EnrichedAlumnus, filters: Filters, except?: FilterKey): boolean {
  for (const key of FILTER_KEYS) {
    if (key === except) continue;
    if (filters[key] && facetValue(item, key) !== filters[key]) return false;
  }
  return true;
}

// Everything a student might type. Routes go through their PUBLIC label so
// quota wording stays unfindable, and the college state is included so the
// home page's "Where they studied" cards land on real results. Institutes
// carry their aliases, so "IITM" finds everyone at IIT Madras.
function searchDocOf(a: Alumnus): SearchDoc {
  const college = collegeDetailsOf(a);
  return buildSearchDoc({
    people: [a.full_name],
    institutes: [
      college?.name, ...(college?.aliases ?? []), a.college_name_raw,
      a.organization?.name, ...(a.organization?.aliases ?? []),
      a.currently_at, a.professional_org,
    ],
    other: [
      a.degree, a.branch, a.field, a.designation, a.stream, officialSchoolName(a.school_name),
      a.professional_course, a.professional_stage,
      publicRouteLabel(a.admission_route), a.admission_rank,
      college?.state, college?.district,
      a.class_of ? String(a.class_of) : null,
    ],
  });
}

function catLabel(key: string): string {
  const c = CATEGORIES.find((x) => x.key === key);
  return c ? `${c.emoji} ${c.label}` : key;
}

function optionLabel(key: FilterKey, value: string): string {
  return key === 'cat' ? catLabel(value) : value;
}

type Group = { key: string; title: string; count: number; items: EnrichedAlumnus[] };

// Batch has its own two-level rendering (year, then school), so it is absent
// here and handled directly in the render.
function groupByLens(items: EnrichedAlumnus[], lens: Lens): Group[] {
  const map = new Map<string, EnrichedAlumnus[]>();
  for (const item of items) {
    const key = lens === 'area' ? item.cat.key : (publicRouteLabel(item.a.admission_route) ?? '');
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      key: key || 'unknown',
      title: key
        ? (lens === 'area' ? catLabel(key) : key)
        : (lens === 'area' ? 'Area not recorded' : 'Route not recorded'),
      count: list.length,
      items: list,
    }))
    // Biggest groups first, but a "not recorded" bucket always sinks: it is
    // the least useful thing a visiting student could open.
    .sort((x, y) => {
      const xUnknown = x.key === 'unknown' ? 1 : 0;
      const yUnknown = y.key === 'unknown' ? 1 : 0;
      return xUnknown - yUnknown || y.count - x.count || x.title.localeCompare(y.title);
    });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main page component
═══════════════════════════════════════════════════════════════════════════ */
export default function DirectoryPage() {
  const [rows, setRows] = useState<Alumnus[] | null>(null);
  const [error, setError] = useState('');
  // Set only when the database returned fewer rows than it holds.
  const [capped, setCapped] = useState(0);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [lens, setLens] = useState<Lens>('batch');
  const [expanded, setExpanded] = useState<EnrichedAlumnus | null>(null);
  const [timelines, setTimelines] = useState<Timelines>({ studies: {}, work: {} });
  // Username from a shared ?p= link, held until the fetch resolves it.
  const [pendingProfileParam, setPendingProfileParam] = useState<string | null>(null);

  // Honour /directory?cat=medicine from the home-page chips. Read once on
  // mount from window.location rather than useSearchParams, which would drag
  // this statically-rendered page into a Suspense boundary for no gain.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = { ...NO_FILTERS };
    const cat = params.get('cat');
    if (cat && CATEGORIES.some((c) => c.key === cat)) next.cat = cat;
    // A filtered view is worth sharing, so every dimension round-trips.
    for (const key of ['batch', 'route', 'status'] as const) {
      const v = params.get(key);
      if (v) next[key] = v;
    }
    setFilters(next);
    const l = params.get('lens');
    if (l && LENSES.some((x) => x.key === l)) setLens(l as Lens);
    // ?q= pre-fills the search box - the home galleries and hero search land here.
    const q = params.get('q');
    if (q) setQuery(q);
    // ?p=<slug> is a shareable profile link, resolved once rows arrive. Links
    // shared before usernames were removed carry ?p=<username> and still work.
    const p = params.get('p');
    if (p) setPendingProfileParam(p.toLowerCase());
  }, []);

  // Fetch approved alumni from the privacy-safe view, then their timelines.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err, total: everyone, truncated } = await fetchApprovedAlumni();
      if (cancelled) return;
      if (err) setError(err);
      setRows(data);
      // Say so rather than quietly showing a subset. PostgREST caps a result
      // server-side and reports nothing; only the count reveals it.
      if (truncated) setCapped(everyone ?? 0);

      const ids = data.map((a) => a.id).filter(Boolean) as string[];
      const t = await fetchTimelines(ids);
      if (!cancelled) setTimelines(t);
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── Directory computations ──────────────────────────────────────────── */
  const enriched = useMemo(
    () => (rows ?? []).map((a) => ({ a, cat: categorize(a.field) })),
    [rows],
  );

  // Built once per load, not per keystroke.
  const searchDocs = useMemo(() => {
    const docs = new WeakMap<Alumnus, SearchDoc>();
    for (const { a } of enriched) docs.set(a, searchDocOf(a));
    return docs;
  }, [enriched]);

  // Searched but not yet filtered - the base every facet count is measured
  // against, so typing in the search box updates the numbers too.
  const { results: searched, closeMatches } = useMemo(
    () => searchItems(enriched, ({ a }) => searchDocs.get(a)!, query),
    [enriched, searchDocs, query],
  );

  const filtered = useMemo(
    () => searched.filter((item) => matchesFilters(item, filters)),
    [searched, filters],
  );

  // Every option's count, measured against the OTHER active filters. That is
  // what guarantees the promise of the bar: no option shown can lead to an
  // empty page, because an option only appears when at least one alumnus
  // survives picking it.
  const facets = useMemo(() => {
    const out = {} as Record<FilterKey, { value: string; label: string; count: number }[]>;
    for (const key of FILTER_KEYS) {
      const counts = new Map<string, number>();
      for (const item of searched) {
        if (!matchesFilters(item, filters, key)) continue;
        const v = facetValue(item, key);
        if (!v) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      out[key] = [...counts.entries()]
        .map(([value, count]) => ({ value, label: optionLabel(key, value), count }))
        // Batches read as a calendar, newest first; everything else by weight.
        .sort((x, y) => (key === 'batch'
          ? Number(y.value) - Number(x.value)
          : y.count - x.count || x.label.localeCompare(y.label)));
    }
    return out;
  }, [searched, filters]);

  const activeFilters = useMemo(
    () => FILTER_KEYS.filter((k) => filters[k]).map((k) => ({ key: k, value: filters[k] })),
    [filters],
  );

  const grouped = useMemo(() => groupByYear(filtered), [filtered]);
  const lensGroups = useMemo(
    () => (lens === 'area' || lens === 'route' ? groupByLens(filtered, lens) : []),
    [filtered, lens],
  );

  // The College lens is built from the FILTERED set, so filters compose with
  // it: "medicine + 2024" narrows the colleges shown, it does not reset them.
  const explorerColleges = useMemo(() => buildExplorerColleges(filtered), [filtered]);
  const withoutCollege = useMemo(
    () => filtered.filter(({ a }) => !(collegeNameOf(a) ?? a.college_name_raw)).length,
    [filtered],
  );

  // Mirror the filters into the URL so a slice is shareable ("look at the
  // 2024 medicine seniors"). replaceState, not pushState: Back should close a
  // profile or leave the page, not rewind six filter clicks one at a time.
  // Skipped on the first pass, which still holds the pre-read defaults.
  const urlReady = useRef(false);
  useEffect(() => {
    if (!urlReady.current) { urlReady.current = true; return; }
    const url = new URL(window.location.href);
    for (const key of FILTER_KEYS) {
      const param = key === 'cat' ? 'cat' : key;
      if (filters[key]) url.searchParams.set(param, filters[key]);
      else url.searchParams.delete(param);
    }
    if (query.trim()) url.searchParams.set('q', query.trim());
    else url.searchParams.delete('q');
    if (lens !== 'batch') url.searchParams.set('lens', lens);
    else url.searchParams.delete('lens');
    window.history.replaceState(window.history.state, '', url);
  }, [filters, query, lens]);

  // Re-keys the card grids so the stagger animation replays when the visible
  // set changes, rather than only on first mount.
  const filterSignature = `${query}|${FILTER_KEYS.map((k) => filters[k]).join('|')}`;

  function setFilter(key: FilterKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  // Open a shared profile once data exists. Misses are ignored silently - a
  // stale link should never error, just land on the directory.
  useEffect(() => {
    if (!pendingProfileParam || !rows) return;
    const hit = findByShareParam(enriched, pendingProfileParam);
    if (hit) setExpanded(hit);
    setPendingProfileParam(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingProfileParam, rows]);

  // Keep the URL in step with the open profile so links are shareable and the
  // browser Back button closes the modal like students expect on a phone.
  useEffect(() => {
    const url = new URL(window.location.href);
    const current = url.searchParams.get('p');
    const wanted = expanded ? shareParam(expanded.a) : null;
    if (wanted && current !== wanted) {
      url.searchParams.set('p', wanted);
      window.history.pushState({ p: wanted }, '', url);
    } else if (!wanted && current) {
      url.searchParams.delete('p');
      window.history.pushState({}, '', url);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(window.location.search).get('p');
      if (!p) setExpanded(null);
      else {
        const hit = findByShareParam(enriched, p);
        if (hit) setExpanded(hit);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched]);



  /* ──────────────────────────────────────────────────────────────────── */
  const total = enriched.length;
  const showing = filtered.length;

  return (
    <div className="container container--wide">
      <div className="fade-up">
        <h1>Alumni Network</h1>
        <p className="subtitle">
          Real paths taken by Veveaham seniors — where they got in, how they got
          in, and what they are doing now.
        </p>
      </div>

      {/* One sticky bar carries everything: search, the four combinable
          filters, what is currently on, and how to switch it off. It stays
          reachable because a student who scrolls to Class of 2019 and then
          wants only medicine should not have to scroll back up. */}
      <div className="filter-bar fade-up" role="search" aria-label="Search and filter alumni" style={{ animationDelay: '0.04s' }}>
        <div className="search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search name, college, exam, company…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search alumni"
          />
        </div>

        <div className="filter-row">
          {FILTER_KEYS.map((key) => (
            <FilterSelect
              key={key}
              name={FILTER_LABELS[key]}
              value={filters[key]}
              options={facets[key]}
              onChange={(v) => setFilter(key, v)}
            />
          ))}
        </div>

        <div className="lens-switch" role="group" aria-label="Group alumni by">
          <span className="lens-switch__label">Group by</span>
          {LENSES.map((l) => (
            <button
              key={l.key}
              type="button"
              className={`lens-btn${lens === l.key ? ' lens-btn--active' : ''}`}
              aria-pressed={lens === l.key}
              onClick={() => setLens(l.key)}
            >
              <span aria-hidden>{l.emoji}</span> {l.label}
            </button>
          ))}
        </div>

        <div className="filter-status">
          <span className="result-count">
            {showing === total
              ? `${total} ${total === 1 ? 'alum' : 'alumni'}`
              : `${showing} of ${total} alumni`}
            {closeMatches && showing > 0 && ` · close matches for “${query.trim()}”`}
            {capped > 0 && ` · showing the first ${total.toLocaleString()} of ${capped.toLocaleString()}`}
          </span>
          {activeFilters.map(({ key, value }) => (
            <button
              key={key}
              type="button"
              className="filter-pill"
              onClick={() => setFilter(key, '')}
              aria-label={`Remove filter ${FILTER_LABELS[key]}: ${optionLabel(key, value)}`}
            >
              {optionLabel(key, value)} <span aria-hidden>✕</span>
            </button>
          ))}
          {(activeFilters.length > 0 || query) && (
            <button
              type="button"
              className="btn btn--plain btn--plain-neutral filter-clear"
              onClick={() => { setFilters(NO_FILTERS); setQuery(''); }}
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {rows === null ? (
        <div className="grid">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" />)}
        </div>
      ) : !isSupabaseConfigured ? (
        <NotConfigured />
      ) : error ? (
        <div className="alert alert--error">Couldn&apos;t load alumni: {error}</div>
      ) : filtered.length === 0 ? (
        <Empty hasData={total > 0} />
      ) : lens === 'batch' ? (
        Array.from(grouped.entries()).map(([year, items], gi) => (
          <GroupSection
            key={year ?? 'unknown'}
            title={`Class of ${year ?? 'Unknown'}`}
            count={items.length}
            defaultOpen={gi < OPEN_GROUPS}
            signature={filterSignature}
          >
            {groupBySchool(items).map(([school, schoolItems]) => (
              <div key={school} style={{ marginBottom: 24 }}>
                <h3 className="school-head">
                  🏫 {school}
                  <span className="school-head__count">{schoolItems.length}</span>
                </h3>
                <PagedGrid
                  items={schoolItems}
                  signature={`${year}|${school}|${filterSignature}`}
                  onExpand={setExpanded}
                />
              </div>
            ))}
          </GroupSection>
        ))
      ) : lens === 'college' ? (
        <>
          <PagedColleges
            colleges={explorerColleges}
            signature={filterSignature}
            onOpen={(a) => {
              const hit = filtered.find((x) => x.a.id === a.id);
              if (hit) setExpanded(hit);
            }}
          />
          {/* Said plainly rather than silently dropping them: someone reading
              for CA has no college, and a count that quietly shrinks would
              make the directory look like it lost people. */}
          {withoutCollege > 0 && (
            <p className="lens-note">
              {withoutCollege} {withoutCollege === 1 ? 'alumnus is' : 'alumni are'} not at a
              college — they appear under{' '}
              <button type="button" className="link-btn" onClick={() => setLens('batch')}>
                Batch
              </button>{' '}
              and{' '}
              <button type="button" className="link-btn" onClick={() => setLens('route')}>
                How they got in
              </button>.
            </p>
          )}
          {explorerColleges.length === 0 && (
            <div className="empty">
              <span className="empty__emoji">🏫</span>
              <h2>No colleges in this slice</h2>
              <p>Everyone matching these filters took a non-college path. Try the Batch lens.</p>
            </div>
          )}
        </>
      ) : (
        lensGroups.map((g, gi) => (
          <GroupSection
            key={g.key}
            title={g.title}
            count={g.count}
            defaultOpen={gi < OPEN_GROUPS}
            signature={filterSignature}
          >
            <PagedGrid items={g.items} signature={`${g.key}|${filterSignature}`} onExpand={setExpanded} />
          </GroupSection>
        ))
      )}

      {expanded && (
        <ProfileModal
          item={expanded}
          timelines={timelines}
          onClose={() => setExpanded(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Filter dropdown

   A native <select> on purpose. It is one tab stop, it is a thumb-friendly
   wheel on iOS, it never traps focus, and it needs no popover code - all of
   which a hand-rolled menu would have had to earn back. The count rides in
   the option text, which is where it is read anyway.
───────────────────────────────────────────────────────────────────────── */
function FilterSelect({
  name, value, options, onChange,
}: {
  name: string;
  value: string;
  options: { value: string; label: string; count: number }[];
  onChange: (v: string) => void;
}) {
  // Nothing to choose between - one option is the whole set.
  if (options.length < 2 && !value) return null;
  const id = `filter-${name.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className={`filter-select${value ? ' filter-select--on' : ''}`}>
      <label className="filter-select__label" htmlFor={id}>{name}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label} ({o.count})</option>
        ))}
      </select>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Groups that fold, and grids that grow
───────────────────────────────────────────────────────────────────────── */

/** Show `step` at a time, and start over whenever the filters change. */
function useShowMore(signature: string, step: number) {
  const [shown, setShown] = useState(step);
  useEffect(() => { setShown(step); }, [signature, step]);
  return { shown, more: () => setShown((n) => n + step) };
}

function ShowMore({ remaining, total, step, one, many, onClick }: {
  remaining: number; total: number; step: number; one: string; many: string; onClick: () => void;
}) {
  const next = Math.min(step, remaining);
  return (
    <button type="button" className="show-more" onClick={onClick}>
      Show {next} more {next === 1 ? one : many} <span className="show-more__of">of {total}</span>
    </button>
  );
}

/**
 * A batch, a route or an area, with a header you can fold.
 *
 * `signature` is the current search and filters: when those change the group
 * returns to its default state, so narrowing to one batch does not leave you
 * looking at a collapsed header.
 */
function GroupSection({ title, count, defaultOpen, signature, children }: {
  title: string; count: number; defaultOpen: boolean; signature: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen, signature]);

  return (
    <section className={`dgroup${open ? ' dgroup--open' : ''}`}>
      <h2 className="dgroup__h">
      <button type="button" className="dgroup__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="dgroup__chev" aria-hidden>▾</span>
        <span className="dgroup__title">{title}</span>
        <span className="dgroup__rule" aria-hidden />
        <span className="dgroup__count">{count} {count === 1 ? 'alum' : 'alumni'}</span>
      </button>
      </h2>
      {open && <div className="dgroup__body">{children}</div>}
    </section>
  );
}

function PagedGrid({ items, signature, onExpand }: {
  items: EnrichedAlumnus[]; signature: string; onExpand: (item: EnrichedAlumnus) => void;
}) {
  const { shown, more } = useShowMore(signature, PAGE);
  return (
    <>
      {/* Keyed on the filters only: growing the list appends new cards without
          remounting - and so re-animating - the ones already on screen. */}
      <div className="grid stagger" key={signature}>
        {items.slice(0, shown).map((item, i) => (
          <Card
            key={item.a.id ?? `${item.a.full_name}-${i}`}
            item={item}
            onExpand={() => onExpand(item)}
          />
        ))}
      </div>
      {items.length > shown && (
        <ShowMore
          remaining={items.length - shown} total={items.length} step={PAGE}
          one="senior" many="seniors" onClick={more}
        />
      )}
    </>
  );
}

function PagedColleges({ colleges, signature, onOpen }: {
  colleges: ExplorerCollege[]; signature: string; onOpen: (a: Alumnus) => void;
}) {
  const { shown, more } = useShowMore(signature, COLLEGE_PAGE);
  return (
    <>
      <div className="stagger" key={signature}>
        {colleges.slice(0, shown).map((college) => (
          <CollegeExplorerCard key={college.key} college={college} onOpen={onOpen} />
        ))}
      </div>
      {colleges.length > shown && (
        <ShowMore
          remaining={colleges.length - shown} total={colleges.length} step={COLLEGE_PAGE}
          one="college" many="colleges" onClick={more}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   College Explorer Card
───────────────────────────────────────────────────────────────────────── */
/**
 * One college, and the seniors who are there.
 *
 * It used to be a mostly empty panel with one full-width button at the bottom
 * hiding everyone behind it, which answered the question ("who from my school
 * is at this college?") only after a click. Now the faces are the card: a
 * thumbnail, the facts as chips, and a row of seniors you can open straight
 * into their profile.
 */
function CollegeExplorerCard({
  college,
  onOpen,
}: {
  college: ExplorerCollege;
  onOpen: (a: Alumnus) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const det = college.details;
  const website = det?.website;

  // Imported names often carry the full postal address:
  // "Charak Institute of Pharmacy, Choli Road, Mandleshwar Block, Khargone 451221".
  // The part before the first comma is the actual name; the rest belongs on the
  // location line. Measured at 375px, headings were running to 5-6 lines.
  const [head, ...restOfName] = college.name.split(',');
  const name = head.trim();
  const place = [restOfName.join(',').trim(), det?.district, det?.state].filter(Boolean).join(', ');

  // The span of ranks that got Veveaham students in here. This is the single
  // most useful line on the page for a student choosing where to aim, and it is
  // non-personal by construction: no rank is attributed to anyone. A wide span
  // is the encouraging case - it shows the door is not only open to toppers.
  const rankSpan = formatRankSpan(college.seniors.map((x) => x.admission_rank));
  const routes = Array.from(
    new Set(
      college.seniors
        .map((x) => publicRouteLabel(x.admission_route))
        .filter(Boolean) as string[],
    ),
  );
  const seniors = showAll ? college.seniors : college.seniors.slice(0, SENIOR_PREVIEW);
  // Groups keyed by id are a real college row, and have a page of their own -
  // banner, photos from the seniors there, the lot. A group that only exists
  // as text somebody typed has nothing to link to yet.
  const pageHref = college.key.startsWith('id:') ? `/colleges/${college.key.slice(3)}` : null;

  return (
    <article className="xcollege">
      <div className="xcollege__top">
        {pageHref ? (
          <Link
            href={pageHref} className="xcollege__thumb" aria-label={`About ${name}`}
            style={{ '--tint': instituteTint(college.key) } as React.CSSProperties}
          >
            {det?.banner_url
              ? <img src={det.banner_url} alt="" loading="lazy" decoding="async" />
              : <span className="xcollege__initials">{instituteInitials(name)}</span>}
          </Link>
        ) : (
          <span
            className="xcollege__thumb" aria-hidden
            style={{ '--tint': instituteTint(college.key) } as React.CSSProperties}
          >
            {det?.banner_url
              ? <img src={det.banner_url} alt="" loading="lazy" decoding="async" />
              : <span className="xcollege__initials">{instituteInitials(name)}</span>}
          </span>
        )}

        <div className="xcollege__head">
          <h3 className="xcollege__name" title={college.name}>
            {pageHref ? <Link href={pageHref} className="xcollege__link">{name}</Link> : name}
          </h3>
          {(place || det?.university_name) && (
            <p className="xcollege__place">
              {place}
              {det?.university_name && det.university_name !== college.name && (
                <> · <span className="xcollege__univ">{det.university_name}</span></>
              )}
            </p>
          )}
          <div className="xcollege__chips">
            <span className="badge badge--sm badge--ok">
              {college.seniors.length} Veveaham {college.seniors.length === 1 ? 'senior' : 'seniors'}
            </span>
            {routes.map((r) => <span key={r} className="badge badge--sm">via {r}</span>)}
            {rankSpan && <span className="badge badge--sm">ranks {rankSpan}</span>}
            {det?.management_type && <span className="badge badge--sm">{det.management_type}</span>}
            {det?.established_year && <span className="badge badge--sm">Est. {det.established_year}</span>}
          </div>
        </div>

        {pageHref ? (
          <Link href={pageHref} className="btn btn--ghost xcollege__site">
            <span className="btn__inner">Open college →</span>
          </Link>
        ) : website ? (
          <a
            href={website.startsWith('http') ? website : `https://${website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--ghost xcollege__site"
          >
            <span className="btn__inner">Website ↗</span>
          </a>
        ) : null}
      </div>

      {det?.description && <p className="college-desc">{det.description}</p>}

      <div className="xcollege__seniors">
        {seniors.map((a, i) => (
          <button
            type="button"
            key={a.id ?? `${a.full_name}-${i}`}
            className="senior-chip"
            onClick={() => onOpen(a)}
          >
            <span className="avatar avatar--xs" aria-hidden>
              {a.show_photo && a.photo_url
                ? <img src={a.photo_url} alt="" loading="lazy" decoding="async" width={34} height={34} />
                : initialsOf(a.full_name)}
            </span>
            <span className="senior-chip__text">
              <span className="senior-chip__name">{a.full_name}</span>
              <span className="senior-chip__meta">
                {[a.class_of ? `Class of ${a.class_of}` : null, a.degree, publicRouteLabel(a.admission_route)]
                  .filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        ))}

        {college.seniors.length > SENIOR_PREVIEW && (
          <button
            type="button"
            className="senior-chip senior-chip--more"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? 'Show fewer' : `+${college.seniors.length - SENIOR_PREVIEW} more`}
          </button>
        )}
      </div>
    </article>
  );
}


/* ─────────────────────────────────────────────────────────────────────────
   Alumnus Card (Directory tab)
───────────────────────────────────────────────────────────────────────── */
function Card({ item, onExpand }: { item: EnrichedAlumnus; onExpand: () => void }) {
  const { a, cat } = item;
  const college = collegeNameOf(a) ?? a.college_name_raw;
  const collegeDet = collegeDetailsOf(a);
  const tintKey = collegeTintKey(a);
  const dept = [a.degree, a.branch].filter(Boolean).join(' · ');
  const now = [a.currently_at, a.designation].filter(Boolean).join(' · ');
  const prof = professionalLabel(a);
  const showImg = a.show_photo && a.photo_url;

  return (
    <article className="a-card" style={{ '--cat': cat.accent } as React.CSSProperties}>
      <div className="a-card__head">
        <div className="avatar">
          {showImg
            ? <img src={a.photo_url!} alt="" loading="lazy" decoding="async" width={52} height={52} />
            : initialsOf(a.full_name)}
        </div>
        <div>
          <div className="a-card__name">{a.full_name}</div>
          <div className="a-card__year">
            Class of {a.class_of ?? '–'}{a.stream ? ` · ${a.stream}` : ''}
          </div>
        </div>
      </div>

      <div className="badge-row">
        <span className="badge">
          <span>{cat.emoji}</span> {cat.label}
        </span>
        {/* Sits alongside the degree rather than replacing it: someone reading
            for CA next to a B.Com should show both. */}
        {prof && <span className="badge badge--prof">📜 {prof}</span>}
      </div>

      {/* The whole point of the directory for a class-11 visitor. It was
          previously two clicks deep, in the modal. */}
      <AdmissionBadges a={a} />

      {collegeDet?.banner_url ? (
        <img className="a-card__banner" src={collegeDet.banner_url} alt="" loading="lazy" />
      ) : tintKey ? (
        <span
          className="a-card__banner" aria-hidden
          style={{ '--tint': instituteTint(tintKey) } as React.CSSProperties}
        />
      ) : null}

      {/* No "School" row here on purpose: these cards are already grouped under
          a school heading, and repeating the full official name cost two
          wrapped lines on every card. The modal still shows it, since a profile
          opened on its own has no grouping context. */}
      <div className="a-card__rows">
        {college && (
          <Row icon="🏛️" label="College">
            <span>{college}</span>
            {collegeDet?.state && (
              <span style={{ color: 'var(--text-faint)', fontSize: '0.82em' }}> · {collegeDet.state}</span>
            )}
          </Row>
        )}
        {dept && <Row icon="🎓" label="Studied">{dept}</Row>}
        {now && <Row icon="💼" label="Now">{now}</Row>}
      </div>

      <div className="a-card__foot">
        <span className="a-status">{a.current_status ?? 'Alumnus'}</span>
        {a.linkedin_url && (
          <a className="a-link" href={a.linkedin_url} target="_blank" rel="noopener noreferrer">
            LinkedIn ↗
          </a>
        )}
      </div>

      <button
        type="button"
        className="btn btn--plain btn--plain-neutral"
        style={{ width: '100%', marginTop: 14 }}
        onClick={onExpand}
      >
        View full profile
      </button>
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Profile Modal
───────────────────────────────────────────────────────────────────────── */
function ProfileModal({
  item, timelines, onClose,
}: {
  item: EnrichedAlumnus;
  timelines: Timelines;
  onClose: () => void;
}) {
  const { a, cat } = item;
  const college = collegeNameOf(a) ?? a.college_name_raw;
  const collegeDet = collegeDetailsOf(a);
  const tintKey = collegeTintKey(a);
  const dept = [a.degree, a.branch].filter(Boolean).join(' · ');
  const now = [a.currently_at, a.designation].filter(Boolean).join(' · ');
  const showImg = a.show_photo && a.photo_url;
  const studies = a.id ? sortHigherStudies(timelines.studies[a.id] ?? []) : [];
  const work = a.id ? sortWorkExperience(timelines.work[a.id] ?? []) : [];

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Lock page scroll, move focus into the dialog, keep Tab inside it, and
  // restore focus to whatever opened it. Without this the page behind kept
  // scrolling and keyboard users tabbed straight out of an open modal.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="a-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className="a-modal"
        style={{ '--cat': cat.accent } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-label={`Profile of ${a.full_name}`}
      >
        {(collegeDet?.banner_url || tintKey) && (
          <div
            className={`a-modal__banner${collegeDet?.banner_url ? '' : ' a-modal__banner--tint'}`}
            aria-hidden
            style={tintKey ? ({ '--tint': instituteTint(tintKey) } as React.CSSProperties) : undefined}
          >
            {collegeDet?.banner_url && <img src={collegeDet.banner_url} alt="" />}
          </div>
        )}

        <button ref={closeRef} type="button" className="a-modal__close" onClick={onClose} aria-label="Close">✕</button>

        <div className="a-modal__head">
          <div className="avatar a-modal__avatar">
            {showImg ? <img src={a.photo_url!} alt="" /> : initialsOf(a.full_name)}
          </div>
          <div>
            <h3 className="a-modal__name">{a.full_name}</h3>
            <div className="a-modal__year">
              Class of {a.class_of ?? '–'}{a.stream ? ` · ${a.stream}` : ''}
            </div>
          </div>
          {shareParam(a) && (
            <button
              type="button"
              className="btn btn--ghost a-modal__share"
              onClick={async () => {
                const url = `${window.location.origin}/alumni/${encodeURIComponent(shareParam(a)!)}`;
                // Native share sheet on phones; clipboard everywhere else.
                try {
                  if (navigator.share) await navigator.share({ title: `${a.full_name} — Veveaham Alumni`, url });
                  else { await navigator.clipboard.writeText(url); alert('Link copied.'); }
                } catch { /* user dismissed the sheet - not an error */ }
              }}
            >
              <span className="btn__inner">Share ↗</span>
            </button>
          )}
        </div>

        <span className="badge" style={{ marginTop: 10, display: 'inline-flex' }}>
          <span>{cat.emoji}</span> {cat.label}
        </span>

        {/* A visitor opens a profile to answer two questions: how did they get
            in, and what do they tell me to do. Both used to sit at the bottom,
            below the college's founding year. They lead now. */}
        <div className="a-modal__section">
          <h4>How they got in</h4>
          <AdmissionBadges a={a} />
          {a.board_cutoff && (
            <p className="modal-note">Cutoff {a.board_cutoff}</p>
          )}
        </div>

        {(a.message_1 || a.message_2) && (
          <div className="a-modal__section">
            <h4>Their advice for juniors</h4>
            {a.message_1 && <p className="a-modal__quote">{a.message_1}</p>}
            {a.message_2 && <p className="a-modal__quote">{a.message_2}</p>}
          </div>
        )}

        {a.school_note && (
          <div className="a-modal__section">
            <h4>A note from Veveaham</h4>
            <p className="a-modal__quote a-modal__quote--school">{a.school_note}</p>
          </div>
        )}

        {/* Education */}
        <div className="a-modal__section">
          <h4>Education</h4>
          <div className="a-card__rows">
            <Row icon="🏫" label="School">
              {officialSchoolName(a.school_name) || '—'}
              {boardForSchool(a.school_name) && (
                <span style={{ color: 'var(--text-faint)' }}> · {boardForSchool(a.school_name)}</span>
              )}
            </Row>
            {college && (
              <Row icon="🏛️" label="College">
                {college}{collegeDet?.state ? ` · ${collegeDet.state}` : ''}
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
            {a.expected_finish_year && (
              <Row icon="📅" label="Expected to finish">{a.expected_finish_year}</Row>
            )}
          </div>
        </div>

        {/* Higher studies timeline */}
        {studies.length > 0 && (
          <div className="a-modal__section">
            <h4>Higher studies</h4>
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
          </div>
        )}

        {/* Work timeline */}
        {work.length > 0 && (
          <div className="a-modal__section">
            <h4>Work experience</h4>
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
          </div>
        )}

        {/* College details */}
        {collegeDet && (collegeDet.website || collegeDet.university_name || collegeDet.established_year || collegeDet.management_type || collegeDet.description || a.college_thoughts) && (
          <div className="a-modal__section">
            <h4>About {college}</h4>
            {collegeDet.description && <p className="college-desc">{collegeDet.description}</p>}
            {a.college_thoughts && (
              <p className="a-modal__quote">In their words: &ldquo;{a.college_thoughts}&rdquo;</p>
            )}
            <div className="college-facts">
              <div className="college-facts__grid">
                {collegeDet.university_name && collegeDet.university_name !== college && (
                  <Fact label="University" value={collegeDet.university_name} />
                )}
                {collegeDet.management_type && <Fact label="Management" value={collegeDet.management_type} />}
                {collegeDet.established_year && <Fact label="Established" value={String(collegeDet.established_year)} />}
                {collegeDet.district && (
                  <Fact label="Location" value={[collegeDet.district, collegeDet.state].filter(Boolean).join(', ')} />
                )}
              </div>
              {collegeDet.website && (
                <a
                  href={collegeDet.website.startsWith('http') ? collegeDet.website : `https://${collegeDet.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn--primary"
                  style={{ display: 'inline-flex', marginTop: 12, fontSize: '0.85rem' }}
                >
                  <span className="btn__inner">Know More about this College ↗</span>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Right now */}
        <div className="a-modal__section">
          <h4>Right now</h4>
          <div className="a-card__rows">
            <Row icon="📌" label="Status">{a.current_status ?? 'Alumnus'}</Row>
            {now && <Row icon="💼" label="At">{now}</Row>}
            {a.linkedin_url && (
              <div className="a-row">
                <span className="a-row__icon" aria-hidden>🔗</span>
                <span>
                  <span className="a-row__label">LinkedIn: </span>
                  <a className="a-link" href={a.linkedin_url} target="_blank" rel="noopener noreferrer">
                    View profile ↗
                  </a>
                </span>
              </div>
            )}
          </div>
        </div>

        {(a.last_updated || a.last_confirmed_at) && (
          <p className="a-modal__meta">
            {a.last_updated && <>Profile updated {formatMonthYear(a.last_updated)}</>}
            {a.last_updated && a.last_confirmed_at && ' · '}
            {a.last_confirmed_at && <>confirmed {formatMonthYear(a.last_confirmed_at)}</>}
          </p>
        )}

      </div>
    </div>
  );
}



function Empty({ hasData }: { hasData: boolean }) {
  return (
    <div className="empty fade-up">
      <span className="empty__emoji">🔍</span>
      <h2>{hasData ? 'No matches here' : 'No approved alumni yet'}</h2>
      <p>
        {hasData
          ? 'Try clearing the search or picking a different area.'
          : 'Once profiles are approved they will show up here.'}
      </p>
      {!hasData && (
        <Link href="/register" className="btn btn--primary" style={{ marginTop: 12 }}>
          <span className="btn__inner">Be the first, register →</span>
        </Link>
      )}
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="empty fade-up">
      <span className="empty__emoji">🔌</span>
      <h2>Connect Supabase to see alumni</h2>
      <p>
        Copy <code>.env.local.example</code> to <code>.env.local</code>, add your
        Supabase URL and anon key, then restart the dev server.
      </p>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
