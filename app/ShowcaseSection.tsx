'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Alumnus, categorize, collegeNameOf, initialsOf } from '../lib/types';

const SELECT =
  'full_name, class_of, stream, degree, branch, field, current_status, currently_at, designation, show_photo, photo_url, linkedin_url, message_1, message_2, colleges(name)';

/**
 * A handful of approved alumni, shown as interactive showcase cards on the
 * home page. Purely presentational, the full, searchable list lives on
 * /directory. Renders nothing if Supabase isn't configured or there's
 * nothing approved yet, so the hero stays the focus in that case.
 */
export default function ShowcaseSection() {
  const [rows, setRows] = useState<Alumnus[] | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('alumni')
        .select(SELECT)
        .eq('approval_status', 'approved')
        .order('class_of', { ascending: false })
        .limit(6);
      if (!cancelled) setRows((data as unknown as Alumnus[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <section className="showcase fade-up" style={{ animationDelay: '0.1s' }}>
      <div className="showcase__head">
        <h2>Meet a few seniors</h2>
        <p className="subtitle">Hover a card for the full story. There are more in the directory.</p>
      </div>

      <div className="showcase-grid stagger">
        {rows.map((a, i) => (
          <ShowcaseCard key={`${a.full_name}-${i}`} a={a} />
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 36 }}>
        <Link href="/directory" className="btn btn--ghost">
          <span className="btn__inner">See the full directory →</span>
        </Link>
      </div>
    </section>
  );
}

function ShowcaseCard({ a }: { a: Alumnus }) {
  const cat = categorize(a.field);
  const college = collegeNameOf(a);
  const now = [a.currently_at, a.designation].filter(Boolean).join(' · ');
  const showImg = a.show_photo && a.photo_url;
  const tip = a.message_1 || a.message_2;

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty('--mx', `${px}%`);
    el.style.setProperty('--my', `${py}%`);

    // 3D tilt: rotate toward the cursor, strongest near the card's edges.
    const rx = (0.5 - py / 100) * 18; // tilt up/down
    const ry = (px / 100 - 0.5) * 18; // tilt left/right
    el.style.setProperty('--rx', `${rx}deg`);
    el.style.setProperty('--ry', `${ry}deg`);
  }

  function handleLeave(e: React.MouseEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }

  return (
    <div
      className="showcase-card"
      style={{ '--cat': cat.accent } as React.CSSProperties}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <div className="showcase-card__glow" />
      <div className="showcase-card__front">
        <div className="avatar avatar--lg showcase-card__pop showcase-card__pop--lg">
          {showImg ? <img src={a.photo_url!} alt={a.full_name} /> : initialsOf(a.full_name)}
        </div>
        <div className="showcase-card__name showcase-card__pop">{a.full_name}</div>
        <div className="showcase-card__meta showcase-card__pop">
          Class of {a.class_of ?? '–'} · {cat.emoji} {cat.label}
        </div>
      </div>

      <div className="showcase-card__back">
        <span className="badge showcase-card__pop" style={{ marginBottom: 10 }}>
          <span>{cat.emoji}</span> {cat.label}
        </span>
        {college && <p className="showcase-card__line showcase-card__pop">🏛️ {college}</p>}
        {now && <p className="showcase-card__line showcase-card__pop">💼 {now}</p>}
        {tip && <p className="showcase-card__quote showcase-card__pop">“{tip}”</p>}
      </div>
    </div>
  );
}
