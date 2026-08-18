'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

export type EntityHit = { id: string; name: string; state?: string | null };

/**
 * Type-ahead over a reference table (colleges or organizations).
 *
 * Replaces three near-identical copies that had drifted apart - the register
 * page searched the `short_names` column, the profile page did not, so the same
 * query gave different results depending on which form you were standing in.
 *
 * The list is searched server-side on every keystroke (debounced) rather than
 * pre-loaded, because `colleges` holds ~47,000 rows and any client-side copy
 * silently stops at PostgREST's 1,000-row cap.
 *
 * Free text is always allowed: an unmatched name is kept as typed and lands in
 * the admin's "unmatched" queue, so a real-but-missing college never blocks a
 * student mid-registration.
 */
export default function EntitySearchField({
  table,
  label,
  hint,
  value,
  onChange,
  onSelect,
  searchShortNames = false,
  required,
  invalid,
}: {
  table: 'colleges' | 'organizations';
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  /** Fires with the matched row when the user picks a suggestion, null when they free-type. */
  onSelect?: (hit: EntityHit | null) => void;
  searchShortNames?: boolean;
  required?: boolean;
  invalid?: boolean;
}) {
  const [results, setResults] = useState<EntityHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const id = useId();
  // Set while we apply a suggestion, so the effect below doesn't immediately
  // re-open the dropdown for the name we just filled in.
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const query = value.trim();
    if (query.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      // Escape PostgREST's `or` filter delimiters. A college with a comma or a
      // parenthesis in its name - "IIT (ISM) Dhanbad" - would otherwise be read
      // as extra filter syntax and error the request out.
      const safe = query.replace(/[(),*]/g, ' ').trim();
      if (!safe) { if (!cancelled) { setResults([]); setLoading(false); } return; }

      const request = searchShortNames
        ? supabase.from(table).select('id, name, state')
            .or(`name.ilike.%${safe}%,short_names.ilike.%${safe}%`)
        : supabase.from(table).select(table === 'colleges' ? 'id, name, state' : 'id, name')
            .ilike('name', `%${safe}%`);

      const { data } = await request.order('name').limit(12);
      if (cancelled) return;
      setResults((data as EntityHit[]) ?? []);
      setHighlight(-1);
      setLoading(false);
    }, 250);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [value, table, searchShortNames]);

  function pick(hit: EntityHit) {
    justPicked.current = true;
    onChange(hit.name);
    onSelect?.(hit);
    setOpen(false);
    setResults([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? results.length - 1 : h - 1));
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault();
      pick(results[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const active = focused || value.trim().length > 0;
  const showList = open && value.trim().length >= 3;

  return (
    <div
      className={`f-field${active ? ' f-field--active' : ''}${invalid ? ' f-field--invalid' : ''}`}
      style={{ position: 'relative' }}
    >
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); onSelect?.(null); setOpen(true); }}
        onFocus={() => { setFocused(true); setOpen(true); }}
        // Delay the blur so a click on a suggestion still registers.
        onBlur={() => { setTimeout(() => { setFocused(false); setOpen(false); }, 150); }}
        onKeyDown={handleKeyDown}
        placeholder=""
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        aria-required={required}
      />
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden> *</span>}</label>
      {hint && <span className="hint">{hint}</span>}

      {showList && (
        <div className="typeahead" role="listbox">
          {loading && <div className="typeahead__msg">Searching…</div>}

          {!loading && results.length === 0 && (
            <div className="typeahead__msg">
              No match — that&apos;s fine, keep what you typed and continue.
            </div>
          )}

          {!loading && results.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={i === highlight}
              className={`typeahead__item${i === highlight ? ' typeahead__item--on' : ''}`}
              onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur doesn't beat the click
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(r)}
            >
              {r.name}
              {r.state && <span className="typeahead__meta"> — {r.state}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
