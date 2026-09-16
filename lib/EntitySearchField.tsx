'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

export type InstituteKind = 'college' | 'organization';

export type EntityHit = {
  id: string;
  name: string;
  state?: string | null;
  district?: string | null;
  matched_alias?: string | null;
};

/**
 * Type-ahead over colleges or organisations, backed by the search_institutes
 * RPC (migration 10).
 *
 * What the old version got wrong, and this one fixes:
 *  - It was an alphabetical substring match, so "IITMadras", "IITM" or
 *    "Indian Institute of Technology Madras" found nothing, and a typo found
 *    nothing. The RPC understands spacing, aliases, acronyms and typos, and
 *    ranks the institute our alumni actually attend first.
 *  - It threw the picked row away and the form re-matched the name on submit,
 *    which failed whenever a name existed twice. onSelect now hands the row
 *    back, and the forms keep its id.
 *  - A failed search looked exactly like "no match". It now says so.
 *
 * Free text is always allowed: an unmatched name is kept as typed and lands in
 * the admin's queue, so a missing college never blocks a registration.
 */
export default function EntitySearchField({
  kind,
  label,
  hint,
  value,
  onChange,
  onSelect,
  required,
  invalid,
}: {
  kind: InstituteKind;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  /** The row when a suggestion is picked; null as soon as the text is edited. */
  onSelect?: (hit: EntityHit | null) => void;
  required?: boolean;
  invalid?: boolean;
}) {
  const [results, setResults] = useState<EntityHit[]>([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const id = useId();
  const listId = `${id}-list`;
  // Set while a suggestion is applied, so the effect below doesn't reopen the
  // list for the name that was just filled in.
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const query = value.trim();
    if (query.replace(/[^a-z0-9]/gi, '').length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .rpc('search_institutes', { p_query: query, p_kind: kind, p_limit: 8 })
        .abortSignal(controller.signal);
      if (controller.signal.aborted) return;
      if (error) {
        setResults([]);
        setStatus('error');
        return;
      }
      setResults((data as EntityHit[]) ?? []);
      setHighlight(-1);
      setStatus('done');
    }, 250);

    return () => { controller.abort(); clearTimeout(timer); };
  }, [value, kind]);

  function pick(hit: EntityHit) {
    justPicked.current = true;
    onChange(hit.name);
    onSelect?.(hit);
    setOpen(false);
    setResults([]);
    setStatus('idle');
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
  const showList = open && status !== 'idle';

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
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
        aria-required={required}
      />
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden> *</span>}</label>
      {hint && <span className="hint">{hint}</span>}

      {showList && (
        <div className="typeahead" role="listbox" id={listId}>
          {status === 'loading' && <div className="typeahead__msg">Searching…</div>}

          {status === 'error' && (
            <div className="typeahead__msg">
              Search isn&apos;t available right now — type the full name and continue.
            </div>
          )}

          {status === 'done' && results.length === 0 && (
            <div className="typeahead__msg">
              No match — that&apos;s fine, keep what you typed and continue.
            </div>
          )}

          {status === 'done' && results.map((r, i) => {
            const place = [r.district, r.state].filter(Boolean).join(', ');
            return (
              <button
                key={r.id}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={`typeahead__item${i === highlight ? ' typeahead__item--on' : ''}`}
                onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur doesn't beat the click
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(r)}
              >
                <span className="typeahead__name">{r.name}</span>
                {(place || r.matched_alias) && (
                  <span className="typeahead__meta">
                    {place}
                    {place && r.matched_alias ? ' · ' : ''}
                    {r.matched_alias && <>matched “{r.matched_alias}”</>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
