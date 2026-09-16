'use client';

import { useRef } from 'react';
import { SCHOOLS, boardForSchool, officialSchoolName } from './options';

/**
 * The three Veveaham schools as a radio list.
 *
 * Replaces pill chips, which wrapped the long official names across lines.
 * Each row shows the board that school follows, because the board is no longer
 * asked for separately - it is derived from the school - and showing it here
 * makes that visible instead of silently filling it in.
 *
 * Keyboard: Tab reaches the group once (roving tabindex), arrow keys move and
 * select, matching native radio buttons.
 */
export default function SchoolPicker({
  value, onChange, invalid = false, labelledBy,
}: {
  value: string;
  onChange: (school: string) => void;
  invalid?: boolean;
  labelledBy?: string;
}) {
  const selected = officialSchoolName(value);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(0, SCHOOLS.findIndex((s) => s === selected));

  function move(from: number, delta: number) {
    const next = (from + delta + SCHOOLS.length) % SCHOOLS.length;
    onChange(SCHOOLS[next]);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-invalid={invalid || undefined}
      className={`school-picker${invalid ? ' school-picker--invalid' : ''}`}
      data-field="school_name"
    >
      {SCHOOLS.map((school, i) => {
        const checked = school === selected;
        return (
          <button
            key={school}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === activeIndex ? 0 : -1}
            className={`school-picker__option${checked ? ' school-picker__option--checked' : ''}`}
            onClick={() => onChange(school)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(i, 1); }
              if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(i, -1); }
            }}
          >
            <span className="school-picker__dot" aria-hidden />
            <span className="school-picker__name">{school}</span>
            <span className="school-picker__board">{boardForSchool(school)}</span>
          </button>
        );
      })}
    </div>
  );
}
