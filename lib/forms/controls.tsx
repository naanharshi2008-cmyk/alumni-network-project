'use client';

/**
 * The few controls the shared form pieces need, in the same markup and
 * classes as registration's and /profile's own - so a piece looks the same
 * wherever it is dropped.
 */

import { useId, useState } from 'react';

export function TextField({
  label, value, onChange, onBlur, hint, error, required, optional, type = 'text', inputMode, autoComplete,
  maxLength, name,
}: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
  hint?: string; error?: string; required?: boolean; optional?: boolean;
  type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string; maxLength?: number; name?: string;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const active = focused || value.trim().length > 0;
  return (
    <div className={`f-field${active ? ' f-field--active' : ''}${error ? ' f-field--invalid' : ''}`} data-field={name}>
      <input
        id={id} type={type} value={value} placeholder="" inputMode={inputMode} autoComplete={autoComplete}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); onBlur?.(); }}
        aria-required={required} aria-invalid={!!error}
      />
      <label htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden> *</span>}
        {optional && <span className="opt">optional</span>}
      </label>
      {error ? <p className="field__error">{error}</p> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function SelectBox({ label, value, onChange, options, placeholder, name }: {
  label: string; value: string; onChange: (v: string) => void; options: readonly string[];
  placeholder?: string; name?: string;
}) {
  const id = useId();
  return (
    <div className="f-field f-field--active" data-field={name}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

/** One answer from a few, as tappable chips. */
export function ChipRow<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: string }[]; value: T | ''; onChange: (v: T) => void; label?: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button" key={o.value} role="radio" aria-checked={value === o.value}
          className={`chip${value === o.value ? ' chip--active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A question with chips under it, and its error. */
export function ChipQuestion<T extends string>({ label, options, value, onChange, error, required, hint, name }: {
  label: string; options: { value: T; label: string }[]; value: T | ''; onChange: (v: T) => void;
  error?: string; required?: boolean; hint?: string; name?: string;
}) {
  return (
    <div className="field" data-field={name}>
      <label>{label}{required && <span className="req" aria-hidden> *</span>}</label>
      <ChipRow options={options} value={value} onChange={onChange} label={label} />
      {hint && <p className="hint" style={{ display: 'block', margin: '6px 0 0' }}>{hint}</p>}
      {error && <p className="field__error field__error--static">{error}</p>}
    </div>
  );
}

/** A collapsed block that stays visibly optional until opened. */
export function OptionalBlock({ title, caption, open, onToggle, children }: {
  title: string; caption: string; open: boolean; onToggle: (v: boolean) => void; children: React.ReactNode;
}) {
  return (
    <div className="opt-section">
      <button type="button" className="opt-section__head" onClick={() => onToggle(!open)} aria-expanded={open}>
        <span>
          <span className="opt-section__title">{title}</span>
          <span className="opt-section__caption">{caption}</span>
        </span>
        <span className="opt-section__toggle">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="opt-section__body">{children}</div>}
    </div>
  );
}
