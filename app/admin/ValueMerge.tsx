'use client';

import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { BUILT_IN_OPTIONS, OPTION_CATEGORY_LABELS, OptionCategory } from '../../lib/options';
import { CATEGORIES } from '../../lib/types';

/**
 * One name per thing.
 *
 * The dropdown lists grow from what people type, so the same exam arrives as
 * "IAT  (IISER Aptitude Test)", "IISER Aptitude Test" and "IAT" - three
 * entries in the directory filter for one exam, and three groups of seniors
 * who cannot find each other. Institutes have had a merge since migration 10;
 * this is the same act for the values.
 *
 * Choosing the public name is the whole point, so it is a text box rather than
 * a "keep this one" radio: the school can correct the spelling while merging,
 * and renaming a single value is simply a merge with nothing else selected.
 *
 * Everything happens in `admin_merge_option` (migration 14), which moves live
 * profiles and the edits waiting for review together, and remembers each old
 * spelling as an alias so next year's typing maps itself instead of splitting
 * the list again.
 */

export type OptionRow = {
  id: number;
  category: string;
  value: string;
  status: string;
  canonical_value: string | null;
};

const CATEGORY_ORDER: OptionCategory[] = [
  'exam', 'branch', 'degree', 'field', 'current_status', 'stream', 'professional_course', 'admission_route',
];

type Usage = { value: string; count: number; approved: boolean; builtIn: boolean };

function builtInsFor(category: OptionCategory): string[] {
  const list = category === 'field' ? CATEGORIES.map((c) => c.label) : BUILT_IN_OPTIONS[category] ?? [];
  return list.filter((v) => v !== 'Other');
}

export default function ValueMergeTab({
  usage, approvedOptions, optionRows, onDone, setError, setNote,
}: {
  /** People per value, per category (admin_option_usage). */
  usage: Record<string, Record<string, number>>;
  approvedOptions: Record<string, string[]>;
  optionRows: OptionRow[];
  onDone: () => Promise<void> | void;
  setError: (msg: string) => void;
  setNote: (msg: string) => void;
}) {
  // What is actually on profiles, plus anything approved that nobody uses yet
  // (an unused list entry is exactly the kind of thing worth merging away).
  const usageByCategory = useMemo(() => {
    const out: Record<string, Usage[]> = {};
    for (const category of CATEGORY_ORDER) {
      const counts = new Map<string, number>();
      for (const [raw, n] of Object.entries(usage[category] ?? {})) {
        const value = raw.trim();
        if (value) counts.set(value, (counts.get(value) ?? 0) + n);
      }
      const approved = new Set(approvedOptions[category] ?? []);
      for (const value of approved) if (!counts.has(value)) counts.set(value, 0);

      const builtIn = new Set(builtInsFor(category));
      out[category] = [...counts.entries()]
        .map(([value, count]) => ({ value, count, approved: approved.has(value), builtIn: builtIn.has(value) }))
        // Used first, then alphabetical: the long tail of typos is what needs work.
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    }
    return out;
  }, [usage, approvedOptions]);

  const aliasesByCategory = useMemo(() => {
    const out: Record<string, OptionRow[]> = {};
    for (const row of optionRows) {
      if (row.canonical_value) (out[row.category] ??= []).push(row);
    }
    return out;
  }, [optionRows]);

  return (
    <div className="stagger">
      {CATEGORY_ORDER.map((category) => (
        <ValueCategoryCard
          key={category}
          category={category}
          values={usageByCategory[category] ?? []}
          aliases={aliasesByCategory[category] ?? []}
          onDone={onDone}
          setError={setError}
          setNote={setNote}
        />
      ))}
    </div>
  );
}

function ValueCategoryCard({
  category, values, aliases, onDone, setError, setNote,
}: {
  category: OptionCategory;
  values: Usage[];
  aliases: OptionRow[];
  onDone: () => Promise<void> | void;
  setError: (msg: string) => void;
  setNote: (msg: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [display, setDisplay] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? values : values.slice(0, 10);
  const name = display.trim().replace(/\s+/g, ' ');
  // Selecting is how you say "these are the same thing"; the name follows the
  // most-used spelling until the school types something of its own.
  // Tidied on the way in, so a value that differs only by a stray double space
  // arrives as a one-click correction rather than something to retype.
  const suggestion = picked.length
    ? (values.find((v) => picked.includes(v.value))?.value ?? picked[0]).replace(/\s+/g, ' ').trim()
    : '';
  const effectiveName = touched ? name : (name || suggestion);
  const renaming = picked.length === 1 && effectiveName && effectiveName !== picked[0];
  const canMerge = !!effectiveName && (picked.length > 1 || !!renaming);

  function toggle(value: string) {
    setPicked((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  async function merge() {
    if (!canMerge) return;
    setBusy(true);
    setError(''); setNote('');
    try {
      const { data, error } = await supabase.rpc('admin_merge_option', {
        p_category: category,
        p_from: picked,
        p_into: effectiveName,
      });
      if (error) throw error;
      const res = (data ?? {}) as { moved_profiles?: number; moved_staged_edits?: number; aliases?: number };
      const moved = res.moved_profiles ?? 0;
      const staged = res.moved_staged_edits ?? 0;
      setNote(
        `“${effectiveName}” is now the public name. ` +
        `${moved} ${moved === 1 ? 'profile' : 'profiles'} moved` +
        (staged ? `, ${staged} waiting ${staged === 1 ? 'edit' : 'edits'} too` : '') +
        `, and ${res.aliases ?? 0} old ${res.aliases === 1 ? 'spelling is' : 'spellings are'} remembered.`,
      );
      setPicked([]); setDisplay(''); setTouched(false);
      await onDone();
    } catch (e: any) {
      setError(`Could not merge: ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function forget(row: OptionRow) {
    setBusy(true);
    setError(''); setNote('');
    try {
      const { error } = await supabase.rpc('admin_forget_alias', { p_category: row.category, p_value: row.value });
      if (error) throw error;
      setNote(`“${row.value}” is no longer remembered. Profiles already moved stay where they are.`);
      await onDone();
    } catch (e: any) {
      setError(`Could not forget that spelling: ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  if (values.length === 0 && aliases.length === 0) return null;

  return (
    <div className="card vmerge">
      <div className="vmerge__head">
        <h3>{OPTION_CATEGORY_LABELS[category]}</h3>
        <span className="vmerge__count">{values.length} {values.length === 1 ? 'value' : 'values'}</span>
      </div>

      {values.length === 0 ? (
        <p className="hint" style={{ display: 'block' }}>Nobody has filled this in yet.</p>
      ) : (
        <>
          <ul className="vmerge__list">
            {visible.map((v) => (
              <li key={v.value}>
                <label className={`vmerge__item${picked.includes(v.value) ? ' is-picked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={picked.includes(v.value)}
                    onChange={() => toggle(v.value)}
                    disabled={busy}
                  />
                  <span className="vmerge__value">{v.value}</span>
                  <span className="vmerge__meta">
                    {v.count > 0
                      ? `${v.count} ${v.count === 1 ? 'profile' : 'profiles'}`
                      : 'nobody yet'}
                    {v.builtIn ? ' · built in' : v.approved ? '' : ' · not in the list'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {values.length > 10 && (
            <button type="button" className="link-btn" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show fewer' : `Show all ${values.length}`}
            </button>
          )}
        </>
      )}

      {picked.length > 0 && (
        <div className="vmerge__act">
          <label className="vmerge__label" htmlFor={`vmerge-${category}`}>
            Public name {picked.length > 1 ? `for these ${picked.length}` : ''}
          </label>
          <input
            id={`vmerge-${category}`}
            type="text"
            value={touched ? display : suggestion}
            maxLength={120}
            disabled={busy}
            onChange={(e) => { setTouched(true); setDisplay(e.target.value); }}
            placeholder="What everyone should see"
          />
          <p className="hint" style={{ display: 'block', margin: '8px 0 12px' }}>
            {picked.length > 1
              ? 'Everyone on these spellings moves to this name, and each old spelling is remembered so the same typing maps itself next time.'
              : 'Edit the name to correct it everywhere at once. The old spelling is remembered.'}
          </p>
          <div className="vmerge__buttons">
            <button type="button" className="btn btn--primary" disabled={!canMerge || busy} onClick={merge}>
              <span className="btn__inner">
                {busy ? 'Merging…' : picked.length > 1 ? `Merge ${picked.length} into one name` : 'Rename everywhere'}
              </span>
            </button>
            <button
              type="button" className="btn btn--ghost" disabled={busy}
              onClick={() => { setPicked([]); setDisplay(''); setTouched(false); }}
            >
              <span className="btn__inner">Clear</span>
            </button>
          </div>
          {!canMerge && (
            <p className="hint" style={{ display: 'block', marginTop: 8 }}>
              {picked.length === 1
                ? 'Pick another spelling to merge, or change the name to rename this one.'
                : 'Give the name to keep.'}
            </p>
          )}
        </div>
      )}

      {aliases.length > 0 && (
        <div className="vmerge__aliases">
          <p className="vmerge__aliases-head">Old spellings we map automatically</p>
          <ul>
            {aliases.map((a) => (
              <li key={a.id}>
                <span className="vmerge__alias">{a.value}</span>
                <span aria-hidden>→</span>
                <span className="vmerge__canon">{a.canonical_value}</span>
                <button type="button" className="link-btn" disabled={busy} onClick={() => forget(a)}>
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
