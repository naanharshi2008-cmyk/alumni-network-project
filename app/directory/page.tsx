'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import {
  Alumnus,
  CategoryKey,
  categorize,
  collegeNameOf,
  collegeDetailsOf,
  initialsOf,
  SCHOOL_NAME,
  CollegeDetails,
} from '../../lib/types';

/* ── Supabase select strings ─────────────────────────────────────────────── */
const ALUMNI_SELECT =
  'id, full_name, username, class_of, stream, degree, branch, field, current_status, currently_at, designation, show_photo, photo_url, linkedin_url, message_1, admission_route, admission_rank, board_marks, colleges(name,state,district,website,university_name,management_type,established_year,is_engineering)';

const COLLEGE_SELECT = 'id, name, state, district, website, university_name, management_type, established_year, is_engineering';

type EnrichedAlumnus = { a: Alumnus; cat: ReturnType<typeof categorize> };

/* ── Batch/year grouping helper ─────────────────────────────────────────── */
function groupByYear(items: EnrichedAlumnus[]): Map<number | null, EnrichedAlumnus[]> {
  const map = new Map<number | null, EnrichedAlumnus[]>();
  for (const item of items) {
    const yr = item.a.class_of;
    if (!map.has(yr)) map.set(yr, []);
    map.get(yr)!.push(item);
  }
  // Sort descending (most recent first)
  return new Map([...map.entries()].sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0)));
}

/* ── College type for the Explorer tab ─────────────────────────────────── */
type CollegeRow = {
  id: string;
  name: string;
  state: string | null;
  district: string | null;
  website: string | null;
  university_name: string | null;
  management_type: string | null;
  established_year: number | null;
  is_engineering: boolean | null;
};

type DirectoryTab = 'directory' | 'explorer';

/* ═══════════════════════════════════════════════════════════════════════════
   Main page component
═══════════════════════════════════════════════════════════════════════════ */
export default function DirectoryPage() {
  const [rows, setRows] = useState<Alumnus[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<CategoryKey | 'all'>('all');
  const [expanded, setExpanded] = useState<{ a: Alumnus; accent: string; label: string; emoji: string } | null>(null);
  const [activeTab, setActiveTab] = useState<DirectoryTab>('directory');

  // College Explorer state
  const [colleges, setColleges] = useState<CollegeRow[]>([]);
  const [explorerState, setExplorerState] = useState('');
  const [explorerQuery, setExplorerQuery] = useState('');

  // Lock page scroll while modal is open; close on Escape
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(null); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [expanded]);

  // Fetch approved alumni
  useEffect(() => {
    if (!isSupabaseConfigured) { setRows([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('alumni')
        .select(ALUMNI_SELECT)
        .eq('approval_status', 'approved')
        .order('class_of', { ascending: false });
      if (cancelled) return;
      if (error) setError(error.message);
      setRows((data as unknown as Alumnus[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch engineering colleges for Explorer
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    (async () => {
      const { data } = await supabase
        .from('colleges')
        .select(COLLEGE_SELECT)
        .eq('is_engineering', true)
        .order('name');
      if (data) setColleges(data as CollegeRow[]);
    })();
  }, []);

  /* ── Directory computations ──────────────────────────────────────────── */
  const enriched = useMemo(
    () => (rows ?? []).map((a) => ({ a, cat: categorize(a.field) })),
    [rows]
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
        a.full_name, collegeNameOf(a), a.degree, a.branch, a.field,
        a.currently_at, a.designation, a.stream, String(a.class_of ?? ''),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [enriched, active, query]);

  const grouped = useMemo(() => groupByYear(filtered), [filtered]);

  /* ── College Explorer computations ──────────────────────────────────── */
  const states = useMemo(() => {
    const s = new Set<string>();
    for (const c of colleges) { if (c.state) s.add(c.state); }
    return Array.from(s).sort();
  }, [colleges]);

  const filteredColleges = useMemo(() => {
    const q = explorerQuery.trim().toLowerCase();
    return colleges.filter(c => {
      if (explorerState && c.state !== explorerState) return false;
      if (q && !c.name.toLowerCase().includes(q) && !(c.district ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [colleges, explorerState, explorerQuery]);

  // Map college name → alumni who went there
  const alumniByCollege = useMemo(() => {
    const map = new Map<string, Alumnus[]>();
    for (const { a } of enriched) {
      const name = collegeNameOf(a);
      if (!name) continue;
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(a);
    }
    return map;
  }, [enriched]);

  /* ──────────────────────────────────────────────────────────────────── */
  return (
    <main className="container">
      {/* Page header */}
      <div className="fade-up">
        <h1>Alumni Network</h1>
        <p className="subtitle">
          From {SCHOOL_NAME} — explore the directory or use the College Explorer to find your path.
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
          🔭 College Explorer <span style={{ opacity: 0.7, fontSize: '0.8em' }}>For Class 11 & 12</span>
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
                <button className={`chip${active === 'all' ? ' chip--active' : ''}`} onClick={() => setActive('all')}>
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
          ) : error ? (
            <div className="alert alert--error">Couldn&apos;t load alumni: {error}</div>
          ) : !isSupabaseConfigured ? (
            <NotConfigured />
          ) : filtered.length === 0 ? (
            <Empty hasData={enriched.length > 0} />
          ) : (
            <>
              <p className="result-count" style={{ marginBottom: 14 }}>
                Showing {filtered.length} {filtered.length === 1 ? 'alum' : 'alumni'}
              </p>
              {/* Year-wise grouping */}
              {Array.from(grouped.entries()).map(([year, items]) => (
                <div key={year ?? 'unknown'} style={{ marginBottom: 40 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16,
                  }}>
                    <h2 style={{
                      margin: 0, fontSize: '1.1rem', fontWeight: 700,
                      background: 'var(--grad-text)', WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}>
                      Class of {year ?? 'Unknown'}
                    </h2>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-faint)' }}>{items.length} alumni</span>
                  </div>
                  <div className="grid stagger" key={`${year}|${active}|${query}`}>
                    {items.map(({ a, cat }, i) => (
                      <Card
                        key={`${a.full_name}-${i}`}
                        a={a}
                        accent={cat.accent}
                        label={cat.label}
                        emoji={cat.emoji}
                        onExpand={() => setExpanded({ a, accent: cat.accent, label: cat.label, emoji: cat.emoji })}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {/* ═══════ COLLEGE EXPLORER TAB ═══════ */}
      {activeTab === 'explorer' && (
        <div className="fade-up">
          <div style={{
            background: 'var(--grad-soft)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r)',
            padding: '20px 24px',
            marginBottom: 28,
          }}>
            <h2 style={{ margin: '0 0 6px 0', fontSize: '1.2rem' }}>🔭 Find Your College Path</h2>
            <p className="subtitle" style={{ margin: 0, fontSize: '0.95rem' }}>
              See which colleges Veveaham seniors got into, what ranks/marks they used, and read their first-hand advice.
            </p>
          </div>

          {/* Filters */}
          <div className="toolbar" style={{ marginBottom: 20 }}>
            <div className="search">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search college name or district…"
                value={explorerQuery}
                onChange={(e) => setExplorerQuery(e.target.value)}
              />
            </div>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              <button
                className={`chip${explorerState === '' ? ' chip--active' : ''}`}
                onClick={() => setExplorerState('')}
              >
                All States
              </button>
              {states.map(s => (
                <button
                  key={s}
                  className={`chip${explorerState === s ? ' chip--active' : ''}`}
                  onClick={() => setExplorerState(explorerState === s ? '' : s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {filteredColleges.length === 0 ? (
            <div className="empty">
              <span className="empty__emoji">🏫</span>
              <h2>No colleges found</h2>
              <p>Try clearing the filters or searching a different name.</p>
            </div>
          ) : (
            <div className="stagger">
              {filteredColleges.map(college => {
                const seniors = alumniByCollege.get(college.name) ?? [];
                return <CollegeExplorerCard key={college.id} college={college} seniors={seniors} />;
              })}
            </div>
          )}
        </div>
      )}

      {expanded && <ProfileModal {...expanded} onClose={() => setExpanded(null)} />}
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   College Explorer Card
───────────────────────────────────────────────────────────────────────── */
function CollegeExplorerCard({
  college,
  seniors,
}: {
  college: CollegeRow;
  seniors: Alumnus[];
}) {
  const [showSeniors, setShowSeniors] = useState(false);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {/* College info header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '1.05rem' }}>{college.name}</h3>
          <p className="subtitle" style={{ margin: 0, fontSize: '0.83rem' }}>
            {[college.district, college.state].filter(Boolean).join(', ')}
            {college.university_name && college.university_name !== college.name && (
              <> · <span style={{ color: 'var(--text-faint)' }}>{college.university_name}</span></>
            )}
          </p>
        </div>
        {college.website && (
          <a
            href={college.website.startsWith('http') ? college.website : `https://${college.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--ghost"
            style={{ padding: '6px 14px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
          >
            Know More ↗
          </a>
        )}
      </div>

      {/* College metadata chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {college.management_type && (
          <span className="badge" style={{ fontSize: '0.75rem' }}>{college.management_type}</span>
        )}
        {college.established_year && (
          <span className="badge" style={{ fontSize: '0.75rem' }}>Est. {college.established_year}</span>
        )}
        {seniors.length > 0 && (
          <span className="badge" style={{ fontSize: '0.75rem', background: 'var(--ok-bg)', color: 'var(--ok-ink)', border: '1px solid var(--ok-border)' }}>
            {seniors.length} Veveaham {seniors.length === 1 ? 'senior' : 'seniors'} here
          </span>
        )}
      </div>

      {/* Seniors section */}
      {seniors.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            onClick={() => setShowSeniors(v => !v)}
            className="btn btn--plain btn--plain-neutral"
            style={{ fontSize: '0.85rem', width: '100%' }}
          >
            <span className="btn__inner">
              {showSeniors ? '▲ Hide seniors' : `▼ View ${seniors.length} senior(s) who went here`}
            </span>
          </button>

          {showSeniors && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {seniors.map((a, i) => (
                <div key={i} style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)',
                  padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div className="avatar" style={{ width: 36, height: 36, fontSize: '1rem', flexShrink: 0 }}>
                      {a.show_photo && a.photo_url ? <img src={a.photo_url} alt={a.full_name} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : initialsOf(a.full_name)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.full_name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Class of {a.class_of} · {a.degree} {a.branch ? `in ${a.branch}` : ''}
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
                  {/* How they got in */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: a.message_1 ? 8 : 0 }}>
                    {a.admission_route && (
                      <span className="badge" style={{ fontSize: '0.72rem' }}>via {a.admission_route}</span>
                    )}
                    {a.admission_rank && (
                      <span className="badge" style={{ fontSize: '0.72rem' }}>Rank {a.admission_rank}</span>
                    )}
                    {a.board_marks && (
                      <span className="badge" style={{ fontSize: '0.72rem' }}>{a.board_marks}% marks</span>
                    )}
                    {a.current_status && (
                      <span className="badge" style={{ fontSize: '0.72rem', opacity: 0.7 }}>{a.current_status}</span>
                    )}
                  </div>
                  {a.message_1 && (
                    <p style={{
                      margin: 0, fontSize: '0.83rem', color: 'var(--text-muted)',
                      fontStyle: 'italic', lineHeight: 1.5,
                      borderLeft: '2px solid var(--border-strong)', paddingLeft: 10,
                    }}>
                      &ldquo;{a.message_1}&rdquo;
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Alumnus Card (Directory tab)
───────────────────────────────────────────────────────────────────────── */
function Card({ a, accent, label, emoji, onExpand }: {
  a: Alumnus; accent: string; label: string; emoji: string; onExpand: () => void;
}) {
  const college = collegeNameOf(a);
  const collegeDet = collegeDetailsOf(a);
  const dept = [a.degree, a.branch].filter(Boolean).join(' · ');
  const now = [a.currently_at, a.designation].filter(Boolean).join(' · ');
  const showImg = a.show_photo && a.photo_url;

  return (
    <article className="a-card" style={{ '--cat': accent } as React.CSSProperties}>
      <div className="a-card__head">
        <div className="avatar">
          {showImg ? <img src={a.photo_url!} alt={a.full_name} /> : initialsOf(a.full_name)}
        </div>
        <div>
          <div className="a-card__name">{a.full_name}</div>
          <div className="a-card__year">
            Class of {a.class_of ?? '–'}{a.stream ? ` · ${a.stream}` : ''}
          </div>
        </div>
      </div>

      <span className="badge" style={{ marginBottom: 12, display: 'inline-flex' }}>
        <span>{emoji}</span> {label}
      </span>

      <div className="a-card__rows">
        <Row icon="🏫" label="School">{SCHOOL_NAME}</Row>
        {college && (
          <Row icon="🏛️" label="College">
            <span>{college}</span>
            {collegeDet?.state && <span style={{ color: 'var(--text-faint)', fontSize: '0.82em' }}> · {collegeDet.state}</span>}
            {collegeDet?.website && (
              <>
                {' '}
                <a
                  href={collegeDet.website.startsWith('http') ? collegeDet.website : `https://${collegeDet.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="a-link"
                  style={{ fontSize: '0.78em' }}
                >
                  Know More ↗
                </a>
              </>
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

      <button type="button" className="btn btn--plain btn--plain-neutral" style={{ width: '100%', marginTop: 14 }} onClick={onExpand}>
        View full profile
      </button>
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Profile Modal
───────────────────────────────────────────────────────────────────────── */
function ProfileModal({ a, accent, label, emoji, onClose }: {
  a: Alumnus; accent: string; label: string; emoji: string; onClose: () => void;
}) {
  const college = collegeNameOf(a);
  const collegeDet = collegeDetailsOf(a);
  const dept = [a.degree, a.branch].filter(Boolean).join(' · ');
  const now = [a.currently_at, a.designation].filter(Boolean).join(' · ');
  const showImg = a.show_photo && a.photo_url;

  return (
    <div
      className="a-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="a-modal" style={{ '--cat': accent } as React.CSSProperties} role="dialog" aria-modal="true">
        <button type="button" className="a-modal__close" onClick={onClose} aria-label="Close">✕</button>

        <div className="a-modal__head">
          <div className="avatar a-modal__avatar">
            {showImg ? <img src={a.photo_url!} alt={a.full_name} /> : initialsOf(a.full_name)}
          </div>
          <div>
            <h3 className="a-modal__name">{a.full_name}</h3>
            <div className="a-modal__year">
              Class of {a.class_of ?? '–'}{a.stream ? ` · ${a.stream}` : ''}
            </div>
          </div>
        </div>

        <span className="badge" style={{ marginTop: 10, display: 'inline-flex' }}>
          <span>{emoji}</span> {label}
        </span>

        {/* Education */}
        <div className="a-modal__section">
          <h4>Education</h4>
          <div className="a-card__rows">
            <Row icon="🏫" label="School">{SCHOOL_NAME}</Row>
            {college && <Row icon="🏛️" label="College">{college}{collegeDet?.state ? ` · ${collegeDet.state}` : ''}</Row>}
            {dept && <Row icon="🎓" label="Studied">{dept}</Row>}
            {a.admission_route && (
              <Row icon="📝" label="Got in via">
                {a.admission_route}
                {a.admission_rank ? ` (Rank ${a.admission_rank})` : ''}
                {a.board_marks ? ` (${a.board_marks}%)` : ''}
              </Row>
            )}
          </div>
        </div>

        {/* College Details Card (Know More) */}
        {collegeDet && (collegeDet.website || collegeDet.university_name || collegeDet.established_year || collegeDet.management_type) && (
          <div className="a-modal__section">
            <h4>About {college}</h4>
            <div style={{
              background: 'var(--grad-soft)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              padding: '14px 16px',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginBottom: collegeDet.website ? 12 : 0 }}>
                {collegeDet.university_name && collegeDet.university_name !== college && (
                  <div>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>University</p>
                    <p style={{ margin: 0, fontSize: '0.88rem' }}>{collegeDet.university_name}</p>
                  </div>
                )}
                {collegeDet.management_type && (
                  <div>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Management</p>
                    <p style={{ margin: 0, fontSize: '0.88rem' }}>{collegeDet.management_type}</p>
                  </div>
                )}
                {collegeDet.established_year && (
                  <div>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Established</p>
                    <p style={{ margin: 0, fontSize: '0.88rem' }}>{collegeDet.established_year}</p>
                  </div>
                )}
                {collegeDet.district && (
                  <div>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Location</p>
                    <p style={{ margin: 0, fontSize: '0.88rem' }}>{[collegeDet.district, collegeDet.state].filter(Boolean).join(', ')}</p>
                  </div>
                )}
              </div>
              {collegeDet.website && (
                <a
                  href={collegeDet.website.startsWith('http') ? collegeDet.website : `https://${collegeDet.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn--primary"
                  style={{ display: 'inline-flex', marginTop: 4, fontSize: '0.85rem' }}
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