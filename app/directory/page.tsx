'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import {
  Alumnus,
  CategoryKey,
  categorize,
  collegeNameOf,
  initialsOf,
  SCHOOL_NAME,
} from '../../lib/types';

const SELECT =
  'full_name, class_of, stream, degree, branch, field, current_status, currently_at, designation, show_photo, photo_url, linkedin_url, message_1, message_2, colleges(name)';

export default function DirectoryPage() {
  const [rows, setRows] = useState<Alumnus[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<CategoryKey | 'all'>('all');
  const [expanded, setExpanded] = useState<{ a: Alumnus; accent: string; label: string; emoji: string } | null>(null);

  // Lock page scroll while the profile modal is open, and let Escape close it.
  useEffect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('alumni')
        .select(SELECT)
        .eq('approval_status', 'approved')
        .order('class_of', { ascending: false });
      if (cancelled) return;
      if (error) setError(error.message);
      setRows((data as unknown as Alumnus[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pre-compute each alumnus's broad category once.
  const enriched = useMemo(
    () => (rows ?? []).map((a) => ({ a, cat: categorize(a.field) })),
    [rows]
  );

  // Only surface category chips that actually have people behind them.
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
        a.currently_at, a.designation, a.stream, a.class_of,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [enriched, active, query]);

  return (
    <main className="container">
      <div className="fade-up">
        <h1>Alumni Directory</h1>
        <p className="subtitle">
          Every approved senior from {SCHOOL_NAME}. Tap an area to filter, or search by name, college or role.
        </p>
      </div>

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

      {/* States */}
      {rows === null ? (
        <div className="grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" />
          ))}
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
          {/* key remounts the grid on filter change so the entrance animation replays */}
          <div className="grid stagger" key={`${active}|${query}`}>
            {filtered.map(({ a, cat }, i) => (
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
        </>
      )}

      {expanded && <ProfileModal {...expanded} onClose={() => setExpanded(null)} />}
    </main>
  );
}

function Card({
  a,
  accent,
  label,
  emoji,
  onExpand,
}: {
  a: Alumnus;
  accent: string;
  label: string;
  emoji: string;
  onExpand: () => void;
}) {
  const college = collegeNameOf(a);
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
        {college && <Row icon="🏛️" label="College">{college}</Row>}
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
        View more
      </button>
    </article>
  );
}

function ProfileModal({
  a,
  accent,
  label,
  emoji,
  onClose,
}: {
  a: Alumnus;
  accent: string;
  label: string;
  emoji: string;
  onClose: () => void;
}) {
  const college = collegeNameOf(a);
  const dept = [a.degree, a.branch].filter(Boolean).join(' · ');
  const now = [a.currently_at, a.designation].filter(Boolean).join(' · ');
  const showImg = a.show_photo && a.photo_url;

  return (
    <div
      className="a-modal-overlay"
      onClick={(e) => {
        // Only close when the backdrop itself is clicked, not the card inside it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="a-modal" style={{ '--cat': accent } as React.CSSProperties} role="dialog" aria-modal="true">
        <button type="button" className="a-modal__close" onClick={onClose} aria-label="Close">
          ✕
        </button>

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

        <div className="a-modal__section">
          <h4>Education</h4>
          <div className="a-card__rows">
            <Row icon="🏫" label="School">{SCHOOL_NAME}</Row>
            {college && <Row icon="🏛️" label="College">{college}</Row>}
            {dept && <Row icon="🎓" label="Studied">{dept}</Row>}
          </div>
        </div>

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