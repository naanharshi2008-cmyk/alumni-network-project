'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Alumnus, CATEGORIES, categorize, collegeDetailsOf } from '../lib/types';
import { publicRouteLabel } from '../lib/options';

/**
 * The three browse galleries on the home page — the TIPS-style "gallery first,
 * profiles second" landing, adapted to this school's India/TNEA focus:
 *
 *   1. What are you interested in?   — study areas (CATEGORIES) with counts
 *   2. How they got in               — admission routes with counts
 *   3. Where they studied            — Indian states of the matched colleges
 *
 * All three render only entries that actually have alumni: fifteen mostly-zero
 * cards would make a young directory look abandoned, and the counts are the
 * proof a sceptical parent is looking for. Routes go through publicRouteLabel,
 * so quota admissions surface under "Board Marks" and no card ever carries a
 * seat-category name.
 *
 * Links: areas use the dedicated ?cat= filter; routes and states land on the
 * directory pre-searched (?q=), which matches those fields in the haystack.
 * Renders nothing until data arrives, so the hero never jumps.
 */
export default function HomeGalleries({ alumni }: { alumni: Alumnus[] | null }) {
  const areas = useMemo(() => {
    if (!alumni) return [];
    const counts = new Map<string, number>();
    for (const a of alumni) {
      const key = categorize(a.field).key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return CATEGORIES
      .filter((c) => c.key !== 'other' && (counts.get(c.key) ?? 0) > 0)
      .map((c) => ({ ...c, count: counts.get(c.key)! }))
      .sort((x, y) => y.count - x.count);
  }, [alumni]);

  const routes = useMemo(() => {
    if (!alumni) return [];
    const counts = new Map<string, number>();
    for (const a of alumni) {
      const label = publicRouteLabel(a.admission_route);
      if (!label) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((x, y) => y.count - x.count);
  }, [alumni]);

  const states = useMemo(() => {
    if (!alumni) return [];
    const counts = new Map<string, number>();
    for (const a of alumni) {
      const st = collegeDetailsOf(a)?.state;
      if (!st) continue;
      counts.set(st, (counts.get(st) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((x, y) => y.count - x.count);
  }, [alumni]);

  if (!alumni || alumni.length === 0) return null;

  return (
    <>
      {areas.length > 0 && (
        <Gallery
          title="What are you interested in?"
          sub="Tap an area to meet the seniors who chose it."
          cards={areas.map((c) => ({
            href: `/directory?cat=${c.key}`,
            emoji: c.emoji,
            label: c.label,
            count: c.count,
            accent: c.accent,
          }))}
        />
      )}

      {routes.length > 0 && (
        <Gallery
          title="How they got in"
          sub="The exams and marks that opened each door."
          cards={routes.map((r) => ({
            href: `/directory?q=${encodeURIComponent(r.label)}`,
            emoji: '📝',
            label: r.label,
            count: r.count,
            accent: 'var(--emerald)',
          }))}
        />
      )}

      {states.length > 0 && (
        <Gallery
          title="Where they studied"
          sub="Colleges our seniors joined, by state."
          cards={states.map((r) => ({
            href: `/directory?q=${encodeURIComponent(r.label)}`,
            emoji: '📍',
            label: r.label,
            count: r.count,
            accent: 'var(--violet)',
          }))}
        />
      )}
    </>
  );
}

function Gallery({
  title, sub, cards,
}: {
  title: string;
  sub: string;
  cards: { href: string; emoji: string; label: string; count: number; accent: string }[];
}) {
  return (
    <section className="gallery fade-up">
      <div className="gallery__head">
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      <div className="gallery__grid stagger">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="gallery-card"
            style={{ '--cat': c.accent } as React.CSSProperties}
          >
            <span className="gallery-card__emoji" aria-hidden>{c.emoji}</span>
            <span className="gallery-card__label">{c.label}</span>
            <span className="gallery-card__count">
              {c.count} {c.count === 1 ? 'senior' : 'seniors'}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
