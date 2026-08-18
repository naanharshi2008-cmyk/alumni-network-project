'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { fetchApprovedAlumni, fetchTimelines } from '../../lib/publicData';
import { officialSchoolName, SCHOOLS } from '../../lib/options';
import {
  Alumnus,
  CategoryKey,
  CollegeDetails,
  HigherStudy,
  WorkExperience,
  categorize,
  collegeNameOf,
  collegeDetailsOf,
  initialsOf,
  sortHigherStudies,
  sortWorkExperience,
  yearRange,
} from '../../lib/types';

type EnrichedAlumnus = { a: Alumnus; cat: ReturnType<typeof categorize> };
type DirectoryTab = 'directory' | 'explorer';
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

/* ═══════════════════════════════════════════════════════════════════════════
   Main page component
═══════════════════════════════════════════════════════════════════════════ */
export default function DirectoryPage() {
  const [rows, setRows] = useState<Alumnus[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<CategoryKey | 'all'>('all');
  const [expanded, setExpanded] = useState<EnrichedAlumnus | null>(null);
  const [activeTab, setActiveTab] = useState<DirectoryTab>('directory');
  const [timelines, setTimelines] = useState<Timelines>({ studies: {}, work: {} });

  // College Explorer filters
  const [explorerState, setExplorerState] = useState('');
  const [explorerQuery, setExplorerQuery] = useState('');

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

  const chips = useMemo(() => {
    const counts = new Map<CategoryKey, number>();
    for (const { cat } of enriched) counts.set(cat.key, (counts.get(cat.key) ?? 0) + 1);
    return enriched
      .map(({ cat }) => cat)
      .filter((c, i, arr) => arr.findIndex((x) => x.key === c.key) === i)
      .sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0))
      .map((c) => ({ ...c, count: counts.get(c.key) ?? 0 }));
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter(({ a, cat }) => {
      if (active !== 'all' && cat.key !== active) return false;
      if (!q) return true;
      const hay = [
        a.full_name, collegeNameOf(a), a.college_name_raw, a.degree, a.branch,
        a.field, a.currently_at, a.designation, a.stream, officialSchoolName(a.school_name),
        String(a.class_of ?? ''),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [enriched, active, query]);

  const grouped = useMemo(() => groupByYear(filtered), [filtered]);

  /* ── College Explorer computations ──────────────────────────────────── */
  const explorerColleges = useMemo(() => buildExplorerColleges(enriched), [enriched]);

  const states = useMemo(() => {
    const s = new Set<string>();
    for (const c of explorerColleges) if (c.details?.state) s.add(c.details.state);
    return Array.from(s).sort();
  }, [explorerColleges]);

  const filteredColleges = useMemo(() => {
    const q = explorerQuery.trim().toLowerCase();
    return explorerColleges.filter((c) => {
      if (explorerState && c.details?.state !== explorerState) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.details?.district ?? '').toLowerCase().includes(q) ||
        (c.details?.state ?? '').toLowerCase().includes(q)
      );
    });
  }, [explorerColleges, explorerState, explorerQuery]);

  /* ──────────────────────────────────────────────────────────────────── */
  return (
    <main className="container">
      <div className="fade-up">
        <h1>Alumni Network</h1>
        <p className="subtitle">
          Real paths taken by Veveaham seniors — browse the directory, or open the
          College Explorer to see exactly where they got in and how.
        </p>
      </div>

      {/* Main tab switcher */}
      <div className="chips fade-up" style={{ animationDelay: '0.04s', marginBottom: 8 }}>
        <button
          className={`chip${activeTab === 'directory' ? ' chip--active' : ''}`}
          onClick={() => setActiveTab('directory')}
        >
          🎓 Alumni Directory
        </button>
        <button
          className={`chip${activeTab === 'explorer' ? ' chip--active' : ''}`}
          onClick={() => setActiveTab('explorer')}
        >
          🔭 College Explorer
          <span className="chip__sub">where seniors got in</span>
        </button>
      </div>

      {/* ═══════ DIRECTORY TAB ═══════ */}
      {activeTab === 'directory' && (
        <>
          <div className="toolbar fade-up" style={{ animationDelay: '0.05s' }}>
            <div className="search">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search name, college, branch, company…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search alumni"
              />
            </div>

            {chips.length > 0 && (
              <div className="chips">
                <button
                  className={`chip${active === 'all' ? ' chip--active' : ''}`}
                  onClick={() => setActive('all')}
                >
                  🌐 All <span style={{ opacity: 0.7 }}>{enriched.length}</span>
                </button>
                {chips.map((c) => (
                  <button
                    key={c.key}
                    className={`chip chip--cat${active === c.key ? ' chip--active' : ''}`}
                    style={{ '--cat': c.accent } as React.CSSProperties}
                    onClick={() => setActive(active === c.key ? 'all' : c.key)}
                  >
                    <span className="chip__emoji">{c.emoji}</span>
                    {c.label} <span style={{ opacity: 0.7 }}>{c.count}</span>
                  </button>
                ))}
              </div>
            )}
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
            <Empty hasData={enriched.length > 0} />
          ) : (
            <>
              <p className="result-count" style={{ marginBottom: 14 }}>
                Showing {filtered.length} {filtered.length === 1 ? 'alum' : 'alumni'}
              </p>

              {Array.from(grouped.entries()).map(([year, items]) => (
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
                      <div className="grid stagger" key={`${year}|${school}|${active}|${query}`}>
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
              ))}
            </>
          )}
        </>
      )}

      {/* ═══════ COLLEGE EXPLORER TAB ═══════ */}
      {activeTab === 'explorer' && (
        <div className="fade-up">
          <div className="explorer-intro">
            <h2>🔭 Where our seniors got in</h2>
            <p className="subtitle" style={{ margin: 0, fontSize: '0.95rem' }}>
              Every college on this list has at least one Veveaham alumnus. Open one to
              see who went there, the rank or marks they got in with, and their advice.
            </p>
          </div>

          <div className="toolbar" style={{ marginBottom: 20 }}>
            <div className="search">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search college, district or state…"
                value={explorerQuery}
                onChange={(e) => setExplorerQuery(e.target.value)}
                aria-label="Search colleges"
              />
            </div>
            {states.length > 0 && (
              <div className="chips" style={{ flexWrap: 'wrap' }}>
                <button
                  className={`chip${explorerState === '' ? ' chip--active' : ''}`}
                  onClick={() => setExplorerState('')}
                >
                  All states
                </button>
                {states.map((s) => (
                  <button
                    key={s}
                    className={`chip${explorerState === s ? ' chip--active' : ''}`}
                    onClick={() => setExplorerState(explorerState === s ? '' : s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {rows === null ? (
            <div className="grid">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton" />)}
            </div>
          ) : filteredColleges.length === 0 ? (
            <div className="empty">
              <span className="empty__emoji">🏫</span>
              <h2>{explorerColleges.length === 0 ? 'No colleges yet' : 'No colleges found'}</h2>
              <p>
                {explorerColleges.length === 0
                  ? 'Once alumni are approved, the colleges they attended appear here.'
                  : 'Try clearing the filters or searching a different name.'}
              </p>
            </div>
          ) : (
            <>
              <p className="result-count" style={{ marginBottom: 14 }}>
                {filteredColleges.length} {filteredColleges.length === 1 ? 'college' : 'colleges'} where
                Veveaham seniors study or studied
              </p>
              <div className="stagger">
                {filteredColleges.map((college) => (
                  <CollegeExplorerCard key={college.key} college={college} timelines={timelines} />
                ))}
              </div>
            </>
          )}
        </div>
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
   College Explorer Card
───────────────────────────────────────────────────────────────────────── */
function CollegeExplorerCard({
  college,
  timelines,
}: {
  college: ExplorerCollege;
  timelines: Timelines;
}) {
  const [showSeniors, setShowSeniors] = useState(false);
  const det = college.details;
  const website = det?.website;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '1.05rem' }}>{college.name}</h3>
          <p className="subtitle" style={{ margin: 0, fontSize: '0.83rem' }}>
            {[det?.district, det?.state].filter(Boolean).join(', ')}
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
              <SeniorMiniCard key={a.id ?? i} a={a} timelines={timelines} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SeniorMiniCard({ a, timelines }: { a: Alumnus; timelines: Timelines }) {
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
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: a.message_1 ? 8 : 0 }}>
        {a.admission_route && <span className="badge badge--xs">via {a.admission_route}</span>}
        {a.admission_rank && <span className="badge badge--xs">Rank {a.admission_rank}</span>}
        {a.board_marks && <span className="badge badge--xs">{a.board_marks}% marks</span>}
        {a.board_cutoff && <span className="badge badge--xs">Cutoff {a.board_cutoff}</span>}
        {a.current_status && <span className="badge badge--xs" style={{ opacity: 0.75 }}>{a.current_status}</span>}
      </div>

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

      {a.message_1 && <p className="senior-mini__quote">&ldquo;{a.message_1}&rdquo;</p>}
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

      <span className="badge" style={{ marginBottom: 12, display: 'inline-flex' }}>
        <span>{cat.emoji}</span> {cat.label}
      </span>

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
        </div>

        <span className="badge" style={{ marginTop: 10, display: 'inline-flex' }}>
          <span>{cat.emoji}</span> {cat.label}
        </span>

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
            {a.admission_route && (
              <Row icon="📝" label="Got in via">
                {a.admission_route}
                {a.admission_rank ? ` (Rank ${a.admission_rank})` : ''}
                {a.board_marks ? ` (${a.board_marks}%)` : ''}
                {a.board_cutoff ? ` (Cutoff ${a.board_cutoff})` : ''}
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
        {collegeDet && (collegeDet.website || collegeDet.university_name || collegeDet.established_year || collegeDet.management_type) && (
          <div className="a-modal__section">
            <h4>About {college}</h4>
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

        {/* Advice */}
        {(a.message_1 || a.message_2) && (
          <div className="a-modal__section">
            <h4>Advice for juniors</h4>
            {a.message_1 && <p className="a-modal__quote">{a.message_1}</p>}
            {a.message_2 && <p className="a-modal__quote">{a.message_2}</p>}
          </div>
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
