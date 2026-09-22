'use client';

import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { fetchApprovedAlumni, fetchPathExtras, fetchTimelines } from '../../lib/publicData';
import { useDebounced } from '../../lib/useDebounced';
import { clearDirectoryView, readDirectoryView, rememberDirectoryView, type DirectorySnapshot } from './viewState';
import { boardForSchool, officialSchoolName, SCHOOLS } from '../../lib/options';
import { isExamRoute, routeLabel, routeParamLabel, routePhrase } from '../../lib/admission';
import { AdmissionBadges, Row } from '../../lib/profileParts';
import { formatRankBand, formatMarksBand, formatRankSpan, formatMonthYear } from '../../lib/text';
import { buildSearchDoc, searchItems, type SearchDoc } from '../../lib/search';
import { collegeTintKey, instituteInitials, instituteTint, profileHref, shortInstituteName } from '../../lib/showcase';
import {
  type PathExtras,
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

function groupByYear(items: EnrichedAlumnus[]): Map<number | null, EnrichedAlumnus[]> {
  const map = new Map<number | null, EnrichedAlumnus[]>();
  for (const item of items) {
    const yr = item.a.class_of;
    if (!map.has(yr)) map.set(yr, []);
    map.get(yr)!.push(item);
  }
  return new Map([...map.entries()].sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0)));
}

// A year is one group. It used to split again by school - "Class of 2024 ->
// Girls -> Prime Academy" - and the owner asked for that to go (Round 10):
// the path is the grouping that matters, and Pathways is where it lives.

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
    case 'route': return routeLabel(a) ?? '';
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

// Everything a student might type. Routes go through their label, so the
// word "quota" is never what finds anyone, and the college state is included so the
// home page's "Where they studied" cards land on real results. Institutes
// carry their aliases, so "IITM" finds everyone at IIT Madras.
// Offers not taken and exams written are searchable too: "VIT Chennai" finds
// everyone who had a seat there, not only the ones who took it.
function searchDocOf(a: Alumnus, extras?: PathExtras): SearchDoc {
  const college = collegeDetailsOf(a);
  return buildSearchDoc({
    people: [a.full_name],
    institutes: [
      college?.name, ...(college?.aliases ?? []), a.college_name_raw,
      a.organization?.name, ...(a.organization?.aliases ?? []),
      a.currently_at, a.professional_org,
      ...(extras?.admits ?? []).flatMap((d) => [d.college?.name, ...(d.college?.aliases ?? []), d.college_name_raw]),
    ],
    other: [
      ...(extras?.attempts ?? []).map((t) => t.exam),
      a.degree, a.branch, a.field, a.designation, a.stream, officialSchoolName(a.school_name),
      a.professional_course, a.professional_stage,
      routeLabel(a), a.admission_rank,
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
    const key = lens === 'area' ? item.cat.key : (routeLabel(item.a) ?? '');
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
  // The box itself is never laggy; everything it drives waits for a pause.
  const settledQuery = useDebounced(query);

  // Where this page was when someone left it for a profile. Read once, then
  // forgotten, so it cannot reassert itself over a later, deliberate visit.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // A search opens every group, so one collapsed earlier cannot hide the two
  // people it just found. Collapsing during a search is kept apart from the
  // arrangement the visitor made, so clearing the search gives theirs back.
  const [searchOpen, setSearchOpen] = useState<Record<string, boolean>>({});
  const [shownBy, setShownBy] = useState<Record<string, number>>({});
  const snapshot = useRef<DirectorySnapshot | null>(null);
  const [restoredScroll, setRestoredScroll] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [lens, setLens] = useState<Lens>('batch');
  const [timelines, setTimelines] = useState<Timelines>({ studies: {}, work: {} });
  const [extras, setExtras] = useState<Record<string, PathExtras>>({});
  // Username from a shared ?p= link, held until the fetch resolves it.

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
      if (v) next[key] = key === 'route' ? routeParamLabel(v) : v;
    }
    setFilters(next);
    const l = params.get('lens');
    if (l && LENSES.some((x) => x.key === l)) setLens(l as Lens);
    // ?q= pre-fills the search box - the home galleries and hero search land here.
    const q = params.get('q');
    if (q) setQuery(q);
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
      const [t, x] = await Promise.all([fetchTimelines(ids), fetchPathExtras(ids)]);
      if (!cancelled) { setTimelines(t); setExtras(x); }
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
    for (const { a } of enriched) docs.set(a, searchDocOf(a, extras[a.id ?? '']));
    return docs;
  }, [enriched, extras]);


  // Searched but not yet filtered - the base every facet count is measured
  // against, so typing in the search box updates the numbers too.
  const { results: searched, closeMatches } = useMemo(
    () => searchItems(enriched, ({ a }) => searchDocs.get(a)!, settledQuery),
    [enriched, searchDocs, settledQuery],
  );

  // Why a card is in the results, when it is not for anything the card shows:
  // an offer they did not take, or an exam they wrote.
  const whyById = useMemo(() => {
    const out = new Map<string, string>();
    if (!settledQuery.trim()) return out;
    for (const { a } of searched) {
      const x = a.id ? extras[a.id] : undefined;
      if (!x || searchItems([a], (p) => searchDocOf(p), settledQuery).results.length) continue;
      const offer = x.admits.find((d) => searchItems([d], (o) => buildSearchDoc({
        people: [], institutes: [o.college?.name, ...(o.college?.aliases ?? []), o.college_name_raw], other: [],
      }), settledQuery).results.length);
      if (offer) {
        const name = offer.college?.name ? shortInstituteName(offer.college.name, offer.college.aliases ?? []) : offer.college_name_raw;
        out.set(a.id!, `Had an offer at ${name}`);
        continue;
      }
      const exam = x.attempts.find((t) => searchItems([t], (e) => buildSearchDoc({ people: [], institutes: [], other: [e.exam] }), settledQuery).results.length);
      if (exam) out.set(a.id!, `Wrote ${exam.exam}`);
    }
    return out;
  }, [searched, extras, settledQuery]);

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
    if (settledQuery.trim()) url.searchParams.set('q', settledQuery.trim());
    else url.searchParams.delete('q');
    if (lens !== 'batch') url.searchParams.set('lens', lens);
    else url.searchParams.delete('lens');
    window.history.replaceState(window.history.state, '', url);
  }, [filters, settledQuery, lens]);

  /**
   * A deliberate reframing of the list: a filter, or a different grouping.
   *
   * The query is NOT part of it, and that is the point. It used to be, so
   * every character typed collapsed every group back to two open, truncated
   * every grid back to twelve cards, and replayed the fade-in on all of them.
   * Typing narrows what you are looking at; it is not a decision to start
   * again. It also re-keys the grids, so the stagger replays when the set is
   * genuinely reframed and not while someone is mid-word.
   */
  const filterSignature = `${FILTER_KEYS.map((k) => filters[k]).join('|')}|${lens}`;
  const searching = settledQuery.trim().length > 0;

  function setFilter(key: FilterKey, value: string) {
    // A new slice of the directory is not the view the snapshot describes.
    clearDirectoryView();
    snapshot.current = null;
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  // Read the snapshot once, on the client only: the server render cannot see
  // sessionStorage, so anything seeded from it would be discarded as a
  // hydration mismatch. Applying it as state after mount is what makes it
  // survive the component remounts that happen when the rows arrive.
  useEffect(() => {
    const snap = readDirectoryView();
    if (!snap) return;
    snapshot.current = snap;
    setOpenGroups(snap.groups ?? {});
    setShownBy(snap.shown ?? {});
  }, []);

  // Scroll last. The grid has no height until the rows land, so restoring
  // before that just scrolls to the bottom of an empty page.
  useLayoutEffect(() => {
    const target = snapshot.current?.scrollY;
    if (!rows || target == null || restoredScroll !== null) return;
    setRestoredScroll(target);
    window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
  }, [rows, restoredScroll]);

  // A filter or a lens change is a reframing: groups and depth go back to
  // their defaults. Typing does neither.
  //
  // Compares the value rather than tracking "have I run before": React runs an
  // effect twice on mount in development, and a first-run flag is already
  // false by the second pass - which reset the arrangement that had just been
  // restored from the snapshot.
  const lastSignature = useRef<string | null>(null);
  useEffect(() => {
    if (lastSignature.current === null || lastSignature.current === filterSignature) {
      lastSignature.current = filterSignature;
      return;
    }
    lastSignature.current = filterSignature;
    setOpenGroups({});
    setShownBy({});
  }, [filterSignature]);

  useEffect(() => { if (!searching) setSearchOpen({}); }, [searching]);

  const view = useMemo<ViewState>(() => ({
    isOpen: (key, fallback) => (searching ? (searchOpen[key] ?? true) : (openGroups[key] ?? fallback)),
    toggle: (key, current) => (searching
      ? setSearchOpen((prev) => ({ ...prev, [key]: !current }))
      : setOpenGroups((prev) => ({ ...prev, [key]: !current }))),
    shownFor: (signature, step) => shownBy[signature] ?? step,
    showMore: (signature, step) => setShownBy((prev) => ({
      ...prev,
      [signature]: (prev[signature] ?? step) + step,
    })),
    remember: () => rememberDirectoryView({
      scrollY: window.scrollY,
      groups: openGroups,
      shown: shownBy,
    }),
  }), [openGroups, searchOpen, searching, shownBy]);

  /* ──────────────────────────────────────────────────────────────────── */
  const total = enriched.length;
  const showing = filtered.length;

  return (
    <ViewContext.Provider value={view}>
    <WhyContext.Provider value={whyById}>
    <div className="container container--wide">
      <div className="fade-up">
        <h1>Alumni Network</h1>
        <p className="subtitle">
          Veveaham seniors — where they studied, how they got there, and what
          they are doing now.
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
          <span className="result-count" role="status">
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
          >
            <PagedGrid items={items} signature={`${year}|${filterSignature}`} />
          </GroupSection>
        ))
      ) : lens === 'college' ? (
        <>
          {/* Two surfaces, two questions. This one regroups the people you
              have already narrowed to; /colleges browses all of them, with
              banners and the photos seniors sent in. Only offered when nothing
              is narrowed - suggesting it mid-filter sends someone to a page
              that answers something else. */}
          <p className="lens-note lens-note--hint">
            {activeFilters.length > 0 || searching
              ? `The colleges of the ${showing} ${showing === 1 ? 'senior' : 'seniors'} matching your filters.`
              : <>Every college our seniors are at. <Link href="/colleges" className="link-btn">Browse them with photos →</Link></>}
          </p>
          <PagedColleges colleges={explorerColleges} signature={filterSignature} />
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
          >
            <PagedGrid items={g.items} signature={`${g.key}|${filterSignature}`} />
          </GroupSection>
        ))
      )}

    </div>
    </WhyContext.Provider>
    </ViewContext.Provider>
  );
}

/**
 * The banner, or the initials tile, with the college's mark over it.
 *
 * The logo arrives in the view from migration 17, so the directory can show it
 * without the second query the colleges grid used to make.
 */
function CollegeThumb({ det, name }: { det: CollegeDetails | null; name: string }) {
  return (
    <>
      {det?.banner_url
        ? <img src={det.banner_url} alt="" loading="lazy" decoding="async" />
        : <span className="xcollege__initials">{instituteInitials(name)}</span>}
      {det?.logo_url && (
        <span className="xcollege__logo"><img src={det.logo_url} alt="" loading="lazy" /></span>
      )}
    </>
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
/**
 * What the page remembers: which groups are open, how far each grid has been
 * expanded, and where you were when you left for a profile.
 *
 * All of it lives in the page rather than in the components that use it. Those
 * components remount whenever the rows arrive or the grouping changes branch,
 * and state held inside them was being thrown away each time - including the
 * state just restored from a snapshot.
 */
type ViewState = {
  isOpen: (key: string, fallback: boolean) => boolean;
  toggle: (key: string, current: boolean) => void;
  shownFor: (signature: string, step: number) => number;
  showMore: (signature: string, step: number) => void;
  remember: () => void;
};

const ViewContext = React.createContext<ViewState | null>(null);

/** Called on the way out to a profile, so Back lands where you left it. */
function useRemember() {
  const view = React.useContext(ViewContext);
  return () => view?.remember();
}

function useShowMore(signature: string, step: number) {
  const view = React.useContext(ViewContext);
  const shown = view?.shownFor(signature, step) ?? step;
  return { shown, more: () => view?.showMore(signature, step) };
}

function ShowMore({ remaining, total, step, one, many, onClick }: {
  remaining: number; total: number; step: number; one: string; many: string; onClick: () => void;
}) {
  const next = Math.min(step, remaining);
  return (
    <button type="button" className="btn btn--ghost show-more" onClick={onClick}>
      <span className="btn__inner">
        Show {next} more {next === 1 ? one : many}
        <span className="show-more__of"> · {total - remaining} of {total}</span>
      </span>
    </button>
  );
}

function GroupSection({ title, count, defaultOpen, children }: {
  title: string; count: number; defaultOpen: boolean; children: React.ReactNode;
}) {
  const view = React.useContext(ViewContext);
  const isOpen = view?.isOpen(title, defaultOpen) ?? defaultOpen;

  return (
    <section className={`dgroup${isOpen ? ' dgroup--open' : ''}`}>
      <h2 className="dgroup__h">
      <button type="button" className="dgroup__head" aria-expanded={isOpen} onClick={() => view?.toggle(title, isOpen)}>
        <span className="dgroup__chev" aria-hidden>▾</span>
        <span className="dgroup__title">{title}</span>
        <span className="dgroup__rule" aria-hidden />
        <span className="dgroup__count">{count} {count === 1 ? 'alum' : 'alumni'}</span>
      </button>
      </h2>
      {isOpen && <div className="dgroup__body">{children}</div>}
    </section>
  );
}

function PagedGrid({ items, signature }: {
  items: EnrichedAlumnus[]; signature: string;
}) {
  const { shown, more } = useShowMore(signature, PAGE);
  return (
    <>
      {/* Keyed on the filters only: growing the list appends new cards without
          remounting - and so re-animating - the ones already on screen. */}
      <div className="grid stagger" key={signature}>
        {items.slice(0, shown).map((item, i) => (
          <Card key={item.a.id ?? `${item.a.full_name}-${i}`} item={item} />
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

function PagedColleges({ colleges, signature }: {
  colleges: ExplorerCollege[]; signature: string;
}) {
  const { shown, more } = useShowMore(signature, COLLEGE_PAGE);
  return (
    <>
      <div className="stagger" key={signature}>
        {colleges.slice(0, shown).map((college) => (
          <CollegeExplorerCard key={college.key} college={college} />
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
}: {
  college: ExplorerCollege;
}) {
  const remember = useRemember();
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
  //
  // Only from seats that came through an exam. A rank typed by someone who
  // then changed their route is kept in their row but never displayed beside
  // a route it does not belong to; the span honours the same rule the
  // individual badges do.
  const rankSpan = formatRankSpan(
    college.seniors.filter((x) => isExamRoute(x)).map((x) => x.admission_rank),
  );
  const routes = Array.from(
    new Set(
      college.seniors
        .map((x) => routePhrase(x))
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
        {/* Written once: the linked and unlinked thumbs had drifted into two
            copies of the same markup, and the logo would have made three. */}
        {pageHref ? (
          <Link
            href={pageHref} className="xcollege__thumb" aria-label={`About ${name}`}
            style={{ '--tint': instituteTint(college.key) } as React.CSSProperties}
          >
            <CollegeThumb det={det} name={name} />
          </Link>
        ) : (
          <span
            className="xcollege__thumb" aria-hidden
            style={{ '--tint': instituteTint(college.key) } as React.CSSProperties}
          >
            <CollegeThumb det={det} name={name} />
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
            {det?.management_type && <span className="badge badge--sm">{det.management_type}</span>}
            {det?.established_year && <span className="badge badge--sm">Est. {det.established_year}</span>}
          </div>
          {/* The span stays - a wide one is the encouraging case - but as a
              line of data under the facts, not a badge standing level with
              how many seniors are here and how they got in. */}
          {rankSpan && <p className="xcollege__span">Seniors here got in with ranks of {rankSpan}.</p>}
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
          <Link
            key={a.id ?? `${a.full_name}-${i}`}
            href={profileHref(a)}
            className="senior-chip"
            onClick={remember}
          >
            <span className="avatar avatar--xs" aria-hidden>
              {a.show_photo && a.photo_url
                ? <img src={a.photo_url} alt="" loading="lazy" decoding="async" width={34} height={34} />
                : initialsOf(a.full_name)}
            </span>
            <span className="senior-chip__text">
              <span className="senior-chip__name">{a.full_name}</span>
              <span className="senior-chip__meta">
                {[a.class_of ? `Class of ${a.class_of}` : null, a.degree, routeLabel(a)]
                  .filter(Boolean).join(' · ')}
              </span>
            </span>
          </Link>
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
/** Why each result matched, when it was not for anything the card shows. */
const WhyContext = createContext<Map<string, string>>(new Map());

function Card({ item }: { item: EnrichedAlumnus }) {
  const remember = useRemember();
  const { a, cat } = item;
  const why = useContext(WhyContext).get(a.id ?? '');
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
      {why && <p className="a-card__why">🔎 {why}</p>}

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

      {/* No "School" row: the full official name cost two wrapped lines on
          every card, and the profile page says it. */}
      <div className="a-card__rows">
        {college && (
          <Row icon="🏛️" label="College">
            {a.college_id
              ? <Link className="a-link" href={`/colleges/${a.college_id}`} onClick={remember}>{college}</Link>
              : <span>{college}</span>}
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

      <Link
        href={profileHref(a)}
        className="btn btn--plain btn--plain-neutral"
        style={{ width: '100%', marginTop: 14 }}
        onClick={remember}
      >
        View full profile
      </Link>
    </article>
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
