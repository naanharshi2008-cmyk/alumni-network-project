'use client';

/**
 * Values students typed under "Other", waiting to join the dropdown lists.
 *
 * Moved out of the admin page unchanged when the dashboard was split into
 * Review / People / Data.
 */

import React, { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toTitleCase } from '../../lib/text';
import { BUILT_IN_OPTIONS, OPTION_CATEGORY_LABELS, OptionCategory } from '../../lib/options';
import { CATEGORIES } from '../../lib/types';
import type { PendingOption } from './adminData';
import { EmptyCard } from './ui';

/* ─────────────────────────────────────────────────────────────────────────
   Pending options: dedupe -> canonical spelling -> approve
───────────────────────────────────────────────────────────────────────── */
export function PendingOptionsTab({
  pendingOptions, approvedOptions, onResolved, onApprovedValue, setError,
}: {
  pendingOptions: PendingOption[];
  approvedOptions: Record<string, string[]>;
  onResolved: (id: number) => void;
  onApprovedValue: (category: string, value: string) => void;
  setError: (msg: string) => void;
}) {
  if (pendingOptions.length === 0) {
    return <EmptyCard emoji="🏷" text="No new options waiting for review." />;
  }

  const byCategory = pendingOptions.reduce<Record<string, PendingOption[]>>((acc, o) => {
    (acc[o.category] ??= []).push(o);
    return acc;
  }, {});

  return (
    <div className="stagger">
      <div className="card" style={{ marginBottom: 18, padding: '14px 18px' }}>
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          These are values students typed under &ldquo;Other&rdquo;. They already show on the
          person&apos;s own profile — approving here is what adds the value to the dropdown
          lists for everyone else. Merge duplicates instead of approving them twice.
        </p>
      </div>

      {Object.entries(byCategory).map(([category, options]) => (
        <div key={category} className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>
            {OPTION_CATEGORY_LABELS[category as OptionCategory] ?? category}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {options.map((option) => (
              <PendingOptionRow
                key={option.id}
                option={option}
                existing={existingValuesFor(category, approvedOptions)}
                onResolved={onResolved}
                onApprovedValue={onApprovedValue}
                setError={setError}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Built-in options plus anything already approved, for the merge dropdown. */
export function existingValuesFor(category: string, approvedOptions: Record<string, string[]>): string[] {
  const builtIn = category === 'field'
    ? CATEGORIES.map((c) => c.label)
    : BUILT_IN_OPTIONS[category as OptionCategory] ?? [];
  const merged = [...builtIn.filter((v) => v !== 'Other'), ...(approvedOptions[category] ?? [])];
  return Array.from(new Set(merged)).sort();
}

export function PendingOptionRow({
  option, existing, onResolved, onApprovedValue, setError,
}: {
  option: PendingOption;
  existing: string[];
  onResolved: (id: number) => void;
  onApprovedValue: (category: string, value: string) => void;
  setError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'merging' | 'approving' | 'rejecting'>('idle');
  const [busy, setBusy] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [canonical, setCanonical] = useState(() => toTitleCase(option.value));

  // Values that look like the submission, surfaced first so near-duplicates
  // ("bsms" vs "BSMS") are obvious rather than something staff must spot.
  const likely = useMemo(() => {
    const v = option.value.toLowerCase().replace(/[^a-z0-9]/g, '');
    return existing.filter((e) => {
      const n = e.toLowerCase().replace(/[^a-z0-9]/g, '');
      return n === v || n.includes(v) || v.includes(n);
    });
  }, [existing, option.value]);

  /**
   * Move everyone on `option.value` to `to`, in the database.
   *
   * This used to rewrite `alumni[category]` from the browser, which cannot
   * reach where an exam or a branch now also lives - attempts, offers, gap
   * years, staged edits - and for an exam named a column that does not exist.
   * admin_merge_option (migration 19) knows every place a value lives, and
   * keeps the typed spelling as an alias, so the same typing next year maps
   * itself instead of arriving here again.
   */
  async function mergeInto(to: string) {
    const { error } = await supabase.rpc('admin_merge_option', {
      p_category: option.category, p_from: [option.value], p_into: to,
    });
    if (error) throw error;
  }

  async function handleMerge() {
    if (!mergeTarget) return;
    setBusy(true);
    try {
      await mergeInto(mergeTarget);
      onResolved(option.id);
    } catch (e: any) {
      setError(`Could not merge "${option.value}": ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    const finalValue = canonical.trim();
    if (!finalValue) return;
    setBusy(true);
    try {
      // A corrected spelling is a merge into it: the profiles carrying the raw
      // value move, and the raw value is remembered as an alias. Approving as
      // typed is just the approval. (A difference in case alone is the same
      // value to the database, so the merge renames the row in place.)
      if (finalValue !== option.value) {
        await mergeInto(finalValue);
      } else {
        const { data: approved, error } = await supabase
          .from('field_options')
          .update({ status: 'approved', canonical_value: null })
          .eq('id', option.id)
          .select('id');
        if (error) throw error;
        if (!approved?.length) throw new Error('the option row was not updated — reload and try again');
      }
      onApprovedValue(option.category, finalValue);
      onResolved(option.id);
    } catch (e: any) {
      setError(`Could not approve "${option.value}": ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    try {
      const { error } = await supabase.from('field_options').delete().eq('id', option.id);
      if (error) throw error;
      onResolved(option.id);
    } catch (e: any) {
      setError(`Could not remove "${option.value}": ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="option-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '1rem' }}>&ldquo;{option.value}&rdquo;</strong>
        {likely.length > 0 && mode === 'idle' && (
          <span className="badge badge--xs" style={{ color: 'var(--gold)' }}>
            looks like {likely.slice(0, 2).join(', ')}
          </span>
        )}
        {mode === 'rejecting' && (
          <div className="delete-confirm" style={{ width: '100%' }}>
            <p style={{ margin: '0 0 10px 0' }}>
              Keep &ldquo;{option.value}&rdquo; out of the dropdown list?
              {' '}
              <strong>It stays on the student&apos;s profile</strong> and won&apos;t come back
              here — use Merge instead if you want their spelling corrected.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn--neutral" disabled={busy} onClick={handleReject}>
                <span className="btn__inner">{busy ? 'Removing…' : 'Yes, keep it off the list'}</span>
              </button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setMode('idle')}>
                <span className="btn__inner">Cancel</span>
              </button>
            </div>
          </div>
        )}
        {mode === 'idle' && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <button type="button" className="tag-add-btn" onClick={() => { setMode('merging'); setMergeTarget(likely[0] ?? ''); }}>
              ⇢ Merge into existing
            </button>
            <button type="button" className="tag-add-btn" onClick={() => setMode('approving')}>
              ✓ Approve as new
            </button>
            <button
              type="button"
              className="tag-add-btn tag-add-btn--danger"
              onClick={() => setMode('rejecting')}
              disabled={busy}
            >
              ✕ Don&apos;t add to the list
            </button>
          </div>
        )}
      </div>

      {mode === 'merging' && (
        <div className="option-row__panel">
          <label className="option-row__label">Replace it everywhere with:</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} style={{ minWidth: 220 }}>
              <option value="" disabled>Choose the correct value…</option>
              {existing.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <button type="button" className="btn btn--primary" onClick={handleMerge} disabled={busy || !mergeTarget}>
              <span className="btn__inner">{busy ? 'Merging…' : 'Merge'}</span>
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setMode('idle')} disabled={busy}>
              <span className="btn__inner">Cancel</span>
            </button>
          </div>
          <p className="option-row__hint">
            Every profile currently showing &ldquo;{option.value}&rdquo; will be updated to the value you pick.
          </p>
        </div>
      )}

      {mode === 'approving' && (
        <div className="option-row__panel">
          <label className="option-row__label">Add to the list with this spelling:</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              value={canonical}
              onChange={(e) => setCanonical(e.target.value)}
              style={{ minWidth: 240 }}
            />
            <button type="button" className="btn btn--primary" onClick={handleApprove} disabled={busy || !canonical.trim()}>
              <span className="btn__inner">{busy ? 'Saving…' : 'Approve'}</span>
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setMode('idle')} disabled={busy}>
              <span className="btn__inner">Cancel</span>
            </button>
          </div>
          <p className="option-row__hint">
            Profiles using the original spelling are corrected to match.
          </p>
        </div>
      )}
    </div>
  );
}
