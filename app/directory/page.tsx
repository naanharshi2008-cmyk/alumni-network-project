'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { fetchApprovedAlumni, fetchTimelines } from '../../lib/publicData';
import { officialSchoolName, publicRouteLabel, SCHOOLS } from '../../lib/options';
import { formatRankBand, formatMarksBand, formatRankSpan, formatMonthYear } from '../../lib/text';
import {
  Alumnus,
  CATEGORIES,
  CollegeDetails,
  HigherStudy,
  WorkExperience,
  categorize,
  collegeNameOf,
  collegeDetailsOf,
  initialsOf,
  professionalLabel,
  sortHigherStudies,
  sortWorkExperience,
  yearRange,
} from '../../lib/types';

type EnrichedAlumnus = { a: Alumnus; cat: ReturnType<typeof categorize> };
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

function buildExplorerColleges(items: EnrichedAlumnus[]): ExplorerCollege[] {
  const map = new Map<string, ExplorerCollege>();
  for (const { a } of items) {
    const name = collegeNameOf(a) ?? a.college_name_raw;
    if (!name) continue;
    const key = name.trim().toLowerCase();
    if (!key) continue;
    let entry = map.get(key);
    if (!entry) {
      entry = { key, name: name.trim(), details: collegeDetailsOf(a), seniors: [] };
      map.set(key, entry);
    }
    // A matched college row carries state/website/etc; keep the richest version.
    if (!entry.details) entry.details = collegeDetailsOf(a);
    entry.seniors.push(a);
  }
  return [...map.values()].sort(
    (x, y) => y.seniors.length - x.seniors.length || x.name.localeCompare(y.name),
  );
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
// home page's "Where they studied" cards land on real results.
function haystack(a: Alumnus): string {
  return [
    a.full_name, collegeNameOf(a), a.college_name_raw, a.degree, a.branch,
    a.field, a.currently_at, a.designation, a.stream, officialSchoolName(a.school_name),
    a.professional_course, a.professional_stage,
    publicRouteLabel(a.admission_route), a.admission_rank,
    collegeDetailsOf(a)?.state,
    String(a.class_of ?? ''),
  ].filter(Boolean).join(' ').toLowerCase();
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
    // ?p=<username> is a shareable profile link; resolved once rows arrive.
    const p = params.get('p');
    if (p) setPendingProfileParam(p.toLowerCase());
  }, []);

  // Fetch approved alumni from the privacy-safe view, then their timelines.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await fetchApprovedAlumni();
      if (cancelled) return;
      if (err) setError(err);
      setRows(data);

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

  // Searched but not yet filtered - the base every facet count is measured
  // against, so typing in the search box updates the numbers too.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return enriched;
    return enriched.filter(({ a }) => haystack(a).includes(q));
  }, [enriched, query]);

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
    const hit = enriched.find(({ a }) => (a.username ?? '').toLowerCase() === pendingProfileParam);
    if (hit) setExpanded(hit);
    setPendingProfileParam(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingProfileParam, rows]);

  // Keep the URL in step with the open profile so links are shareable and the
  // browser Back button closes the modal like students expect on a phone.
  useEffect(() => {
    const url = new URL(window.location.href);
    const current = url.searchParams.get('p');
    const wanted = expanded?.a.username ?? null;
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
        const hit = enriched.find(({ a }) => (a.username ?? '').toLowerCase() === p.toLowerCase());
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
    <main className="container">
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
      <div className="filter-bar fade-up" style={{ animationDelay: '0.04s' }}>
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
        Array.from(grouped.entries()).map(([year, items]) => (
          <div key={year ?? 'unknown'} style={{ marginBottom: 40 }}>
            <div className="year-head">
              <h2 className="year-head__title">Class of {year ?? 'Unknown'}</h2>
              <div className="year-head__rule" />
              <span className="year-head__count">{items.length} alumni</span>
            </div>

            {groupBySchool(items).map(([school, schoolItems]) => (
              <div key={school} style={{ marginBottom: 24 }}>
                <h3 className="school-head">
                  🏫 {school}
                  <span className="school-head__count">{schoolItems.length}</span>
                </h3>
                <div className="grid stagger" key={`${year}|${school}|${filterSignature}`}>
                  {schoolItems.map((item, i) => (
                    <Card
                      key={item.a.id ?? `${item.a.full_name}-${i}`}
                      item={item}
                      onExpand={() => setExpanded(item)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      ) : lens === 'college' ? (
        <>
          <div className="stagger">
            {explorerColleges.map((college) => (
              <CollegeExplorerCard
                key={college.key}
                college={college}
                timelines={timelines}
                onOpen={(a) => {
                  const hit = filtered.find((x) => x.a.id === a.id);
                  if (hit) setExpanded(hit);
                }}
              />
            ))}
          </div>
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
        lensGroups.map((g) => (
          <div key={g.key} style={{ marginBottom: 36 }}>
            <div className="group-head">
              <h2 className="group-head__title">{g.title}</h2>
              <div className="year-head__rule" />
              <span className="year-head__count">{g.count} {g.count === 1 ? 'alum' : 'alumni'}</span>
            </div>
            <div className="grid stagger" key={`${g.key}|${filterSignature}`}>
              {g.items.map((item, i) => (
                <Card
                  key={item.a.id ?? `${item.a.full_name}-${i}`}
                  item={item}
                  onExpand={() => setExpanded(item)}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {expanded && (
        <ProfileModal
          item={expanded}
          timelines={timelines}
          onClose={() => setExpanded(null)}
        />
      )}
    </main>
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
   College Explorer Card
───────────────────────────────────────────────────────────────────────── */
function CollegeExplorerCard({
  college,
  timelines,
  onOpen,
}: {
  college: ExplorerCollege;
  timelines: Timelines;
  onOpen: (a: Alumnus) => void;
}) {
  const [showSeniors, setShowSeniors] = useState(false);
  const det = college.details;
  const website = det?.website;

  // Imported names often carry the full postal address:
  // "Charak Institute of Pharmacy, Choli Road, Mandleshwar Block, Khargone 451221".
  // The part before the first comma is the actual name; the rest belongs on the
  // location line. Measured at 375px, headings were running to 5-6 lines.
  const [shortName, ...restOfName] = college.name.split(',');
  const nameTail = restOfName.join(',').trim();

  // B2b - the span of ranks that got Veveaham students in here. This is the
  // single most useful line on the page for a student choosing where to aim,
  // and it is non-personal by construction: no rank is attributed to anyone.
  // A wide span is the encouraging case - it shows the door is not only open
  // to toppers - so it is worth showing even from a handful of data points.
  const rankSpan = formatRankSpan(college.seniors.map((x) => x.admission_rank));
  const routes = Array.from(
    new Set(
      college.seniors
        .map((x) => publicRouteLabel(x.admission_route))
        .filter(Boolean) as string[],
    ),
  );

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {det?.banner_url && (
        <img className="college-banner" src={det.banner_url} alt="" loading="lazy" />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '1.05rem' }} title={college.name}>
            {shortName.trim()}
          </h3>
          <p className="subtitle" style={{ margin: 0, fontSize: '0.83rem' }}>
            {[nameTail, det?.district, det?.state].filter(Boolean).join(', ')}
            {det?.university_name && det.university_name !== college.name && (
              <> · <span style={{ color: 'var(--text-faint)' }}>{det.university_name}</span></>
            )}
          </p>
        </div>
        {website && (
          <a
            href={website.startsWith('http') ? website : `https://${website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--ghost"
            style={{ padding: '6px 14px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
          >
            Know More ↗
          </a>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {det?.management_type && <span className="badge badge--sm">{det.management_type}</span>}
        {det?.established_year && <span className="badge badge--sm">Est. {det.established_year}</span>}
        <span className="badge badge--sm badge--ok">
          {college.seniors.length} Veveaham {college.seniors.length === 1 ? 'senior' : 'seniors'} here
        </span>
      </div>

      {det?.description && (
        <p className="college-desc">{det.description}</p>
      )}

      {(rankSpan || routes.length > 0) && (
        <p className="college-span">
          {routes.length > 0 && (
            <>Seniors got in through <strong>{routes.join(', ')}</strong></>
          )}
          {rankSpan && routes.length > 0 && ', with '}
          {rankSpan && !routes.length && 'Seniors got in with '}
          {rankSpan && (
            <>ranks {rankSpan}</>
          )}
          .
        </p>
      )}

      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          onClick={() => setShowSeniors((v) => !v)}
          className="btn btn--plain btn--plain-neutral"
          style={{ fontSize: '0.85rem', width: '100%' }}
          aria-expanded={showSeniors}
        >
          <span className="btn__inner">
            {showSeniors
              ? '▲ Hide seniors'
              : `▼ See ${college.seniors.length} senior${college.seniors.length === 1 ? '' : 's'} who got in`}
          </span>
        </button>

        {showSeniors && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {college.seniors.map((a, i) => (
              <SeniorMiniCard key={a.id ?? i} a={a} timelines={timelines} onOpen={() => onOpen(a)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "How they got in", as badges.
 *
 * This is the answer a visiting student came for, so it appears on the card,
 * in the modal, and on the Explorer mini-card rather than being buried.
 *
 * The route leads and is always shown when present - every one of the alumni
 * on an exam route has one, and "via JEE Main" states that the path exists
 * without ranking anybody. Rank and marks follow only when given, and always
 * as bands: see formatRankBand in lib/text.ts for why exact figures are the
 * wrong call here.
 */
function AdmissionBadges({ a, showStatus = false }: { a: Alumnus; showStatus?: boolean }) {
  const rank = formatRankBand(a.admission_rank);
  const marks = formatMarksBand(a.board_marks);
  if (!a.admission_route && !rank && !marks) return null;

  return (
    <div className="admission-row">
      {a.admission_route && <span className="badge badge--xs">via {publicRouteLabel(a.admission_route)}</span>}
      {rank && <span className="badge badge--xs">{rank}</span>}
      {marks && <span className="badge badge--xs">{marks} marks</span>}
      {showStatus && a.current_status && (
        <span className="badge badge--xs" style={{ opacity: 0.75 }}>{a.current_status}</span>
      )}
    </div>
  );
}

function SeniorMiniCard({ a, timelines, onOpen }: { a: Alumnus; timelines: Timelines; onOpen?: () => void }) {
  const studies = a.id ? sortHigherStudies(timelines.studies[a.id] ?? []) : [];
  const work = a.id ? sortWorkExperience(timelines.work[a.id] ?? []) : [];

  return (
    <div className="senior-mini">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div className="avatar avatar--sm">
          {a.show_photo && a.photo_url ? <img src={a.photo_url} alt="" /> : initialsOf(a.full_name)}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.full_name}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Class of {a.class_of ?? '–'}
            {a.degree ? ` · ${a.degree}` : ''}
            {a.branch ? ` in ${a.branch}` : ''}
            {professionalLabel(a) ? ` · ${professionalLabel(a)}` : ''}
          </div>
        </div>
        {a.linkedin_url && (
          <a
            href={a.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="a-link"
            style={{ marginLeft: 'auto', fontSize: '0.78rem' }}
          >
            LinkedIn ↗
          </a>
        )}
      </div>

      {/* How they got in - the part juniors are actually here for. */}
      <AdmissionBadges a={a} showStatus />

      {(studies.length > 0 || work.length > 0) && (
        <div className="senior-mini__timeline">
          {studies.map((s) => (
            <div key={s.id}>🎓 {s.degree_name}{s.institution ? ` — ${s.institution}` : ''} {yearRange(s.start_year, s.finish_year)}</div>
          ))}
          {work.map((w) => (
            <div key={w.id}>💼 {w.role ? `${w.role}, ` : ''}{w.company} {yearRange(w.start_year, w.end_year, w.is_current)}</div>
          ))}
        </div>
      )}

      {a.college_thoughts
        ? <p className="senior-mini__quote">&ldquo;{a.college_thoughts}&rdquo;</p>
        : a.message_1 && <p className="senior-mini__quote">&ldquo;{a.message_1}&rdquo;</p>}

      {/* The College lens used to be a dead end: you could read the mini-card
          but not reach the full profile without switching lens and hunting. */}
      {onOpen && (
        <button type="button" className="link-btn senior-mini__more" onClick={onOpen}>
          View full profile →
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Alumnus Card (Directory tab)
───────────────────────────────────────────────────────────────────────── */
function Card({ item, onExpand }: { item: EnrichedAlumnus; onExpand: () => void }) {
  const { a, cat } = item;
  const college = collegeNameOf(a) ?? a.college_name_raw;
  const collegeDet = collegeDetailsOf(a);
  const dept = [a.degree, a.branch].filter(Boolean).join(' · ');
  const now = [a.currently_at, a.designation].filter(Boolean).join(' · ');
  const prof = professionalLabel(a);
  const showImg = a.show_photo && a.photo_url;

  return (
    <article className="a-card" style={{ '--cat': cat.accent } as React.CSSProperties}>
      <div className="a-card__head">
        <div className="avatar">
          {showImg ? <img src={a.photo_url!} alt="" /> : initialsOf(a.full_name)}
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

      {collegeDet?.banner_url && (
        <img className="a-card__banner" src={collegeDet.banner_url} alt="" loading="lazy" />
      )}

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
        {collegeDet?.banner_url && (
          <div className="a-modal__banner" aria-hidden>
            <img src={collegeDet.banner_url} alt="" />
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
          {a.username && (
            <button
              type="button"
              className="btn btn--ghost a-modal__share"
              onClick={async () => {
                const url = `${window.location.origin}/directory?p=${encodeURIComponent(a.username!)}`;
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
            <Row icon="🏫" label="School">{officialSchoolName(a.school_name) || '—'}</Row>
            {college && (
              <Row icon="🏛️" label="College">
                {college}{collegeDet?.state ? ` · ${collegeDet.state}` : ''}
              </Row>
            )}
            {dept && <Row icon="🎓" label="Studied">{dept}</Row>}
            {professionalLabel(a) && (
              <Row icon="📜" label={a.degree ? 'Also pursuing' : 'Pursuing'}>{professionalLabel(a)}</Row>
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

/* ─────────────────────────────────────────────────────────────────────────
   Utility components
───────────────────────────────────────────────────────────────────────── */
function Row({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="a-row">
      <span className="a-row__icon" aria-hidden>{icon}</span>
      <span><span className="a-row__label">{label}: </span>{children}</span>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="college-facts__label">{label}</p>
      <p className="college-facts__value">{value}</p>
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
