'use client';

import { useId, useMemo, useState } from 'react';
import { normText } from './exams';

/**
 * Type-ahead over a short vocabulary - branches, exams - that knows each
 * one's other spellings.
 *
 * The school's form sheets held 161 spellings for 202 courses: "CSE",
 * "C.S.E", "B.E cse" and "Computer science engineering" are one branch. A
 * plain text box keeps every spelling apart; a select cannot hold all the
 * branches there are. This suggests the canonical name as someone types any
 * of its spellings, and still accepts free text, so a branch the list does
 * not have never blocks anyone.
 *
 * `aliases` maps a normalised spelling to the name it stands for - the
 * shape fetchOptionAliases() returns per category. `extra` carries readings
 * that depend on context, such as "CS" under a BCom (see
 * contextualBranchAliases in lib/forms/model.ts).
 */
export default function OptionSearchField({
  label, hint, value, onChange, options, aliases = {}, extra = {}, required, invalid, error, name,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  aliases?: Record<string, string>;
  extra?: Record<string, string>;
  required?: boolean;
  invalid?: boolean;
  error?: string;
  /** For "take me to the problem" scrolling. */
  name?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const suggestions = useMemo(() => {
    const q = normText(value);
    if (q.replace(/[^a-z0-9]/g, '').length < 1) return [] as { name: string; via: string | null }[];
    const seen = new Set<string>();
    const out: { name: string; via: string | null; score: number }[] = [];
    const add = (name: string, via: string | null, score: number) => {
      const k = normText(name);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ name, via, score });
    };
    // A spelling that means exactly one thing leads.
    for (const [spelling, canonical] of Object.entries({ ...aliases, ...extra })) {
      if (spelling === q) add(canonical, spelling === normText(canonical) ? null : value.trim(), 0);
    }
    for (const o of options) {
      const n = normText(o);
      if (n === q) add(o, null, 1);
      else if (n.startsWith(q)) add(o, null, 2);
      else if (n.split(/[\s(]+/).some((w) => w.startsWith(q))) add(o, null, 3);
      else if (q.length >= 3 && n.includes(q)) add(o, null, 4);
    }
    for (const [spelling, canonical] of Object.entries(aliases)) {
      if (spelling !== q && q.length >= 2 && spelling.startsWith(q)) add(canonical, spelling, 5);
    }
    return out.sort((x, y) => x.score - y.score || x.name.length - y.name.length).slice(0, 8);
  }, [value, options, aliases, extra]);

  // Nothing to suggest when what is typed already is the name.
  const exact = suggestions.length === 1 && normText(suggestions[0].name) === normText(value);
  const showList = open && focused && suggestions.length > 0 && !exact;

  function pick(name: string) {
    onChange(name);
    setOpen(false);
    setHighlight(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1)); }
    else if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); pick(suggestions[highlight].name); }
    else if (e.key === 'Escape') setOpen(false);
  }

  const active = focused || value.trim().length > 0;
  return (
    <div className="field" data-field={name}>
      <div
        className={`f-field${active ? ' f-field--active' : ''}${invalid || error ? ' f-field--invalid' : ''}`}
        style={{ position: 'relative' }}
      >
        <input
          id={id} type="text" value={value} placeholder="" autoComplete="off"
          onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(-1); }}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onBlur={() => { setTimeout(() => { setFocused(false); setOpen(false); }, 150); }}
          onKeyDown={handleKeyDown}
          role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
          aria-required={required} aria-invalid={!!(invalid || error)}
        />
        <label htmlFor={id}>{label}{required && <span className="req" aria-hidden> *</span>}</label>
        {error ? <p className="field__error">{error}</p> : hint ? <span className="hint">{hint}</span> : null}

        {showList && (
          <div className="typeahead" role="listbox" id={listId}>
            {suggestions.map((s, i) => (
              <button
                key={s.name} id={`${listId}-${i}`} type="button" role="option" aria-selected={i === highlight}
                className={`typeahead__item${i === highlight ? ' typeahead__item--on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(s.name)}
              >
                <span className="typeahead__name">{s.name}</span>
                {s.via && <span className="typeahead__meta">for “{s.via}”</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
