'use client';

/**
 * A college or company somebody typed that we could not match to a row.
 *
 * Moved out of the admin page unchanged when the dashboard was split into
 * Review / People / Data.
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import EntitySearchField, { type EntityHit } from '../../lib/EntitySearchField';
import { instKey } from '../../lib/instituteKey';
import { toTitleCase } from '../../lib/text';

/* ─────────────────────────────────────────────────────────────────────────
   Unmatched college / company correction
───────────────────────────────────────────────────────────────────────── */
export function UnmatchedEntityRow({
  kind, groupKey, display, alumniIds, onResolved,
}: {
  kind: 'colleges' | 'organizations';
  groupKey: string;
  display: string;
  alumniIds: string[];
  onResolved: (key: string) => void;
}) {
  const rpcKind = kind === 'colleges' ? 'college' : 'organization';
  const [mode, setMode] = useState<'idle' | 'editing' | 'saving'>('idle');
  const [draft, setDraft] = useState(display);
  const [pick, setPick] = useState<EntityHit | null>(null);
  // Remembering a 2-3 letter spelling as an alias is how "CIT" ends up meaning
  // two colleges, so short ones start unticked.
  const [remember, setRemember] = useState(instKey(display).length > 3);
  const [message, setMessage] = useState('');

  async function open() {
    setMode('editing');
    setMessage('');
    // Start from the best existing match, so most links are one click.
    const { data } = await supabase.rpc('search_institutes', { p_query: display, p_kind: rpcKind, p_limit: 1 });
    const top = (data as EntityHit[] | null)?.[0];
    if (top) { setPick(top); setDraft(top.name); }
  }

  async function link(entityId: string) {
    const { error } = await supabase.rpc('admin_link_alumni', {
      p_kind: rpcKind, p_alumni_ids: alumniIds, p_entity_id: entityId, p_typed: display, p_remember: remember,
    });
    if (error) throw error;
    onResolved(groupKey);
  }

  async function linkToPick() {
    if (!pick) return;
    setMode('saving'); setMessage('');
    try { await link(pick.id); } catch (e: any) { setMessage(e?.message ?? 'Something went wrong.'); setMode('editing'); }
  }

  async function createAndLink() {
    const name = toTitleCase(draft.trim());
    if (!name) return;
    setMode('saving'); setMessage('');
    try {
      const { data: newId, error } = await supabase.rpc('admin_create_institute', { p_kind: rpcKind, p_name: name });
      if (error) throw error;
      await link(newId as string);
    } catch (e: any) {
      setMessage(e?.message ?? 'Something went wrong.');
      setMode('editing');
    }
  }

  return (
    <div className="card" style={{ marginBottom: 14, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700 }}>{display}</p>
          <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--text-faint)' }}>
            Typed by {alumniIds.length} {alumniIds.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        {mode === 'idle' && (
          <button type="button" onClick={open} className="btn btn--ghost">
            <span className="btn__inner">Link to an institute</span>
          </button>
        )}
      </div>

      {mode !== 'idle' && (
        <div style={{ marginTop: 12 }}>
          <EntitySearchField
            kind={rpcKind}
            label={kind === 'colleges' ? 'Which college is this?' : 'Which organisation is this?'}
            hint="pick the existing record — short names and typos are fine"
            value={draft}
            onChange={setDraft}
            onSelect={setPick}
          />
          <label className="cbox-row" style={{ marginTop: 10 }}>
            <span className="cbox">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className="cbox__mark" />
            </span>
            <span>Remember “{display}” as another name for it, so the next person who types it is matched automatically</span>
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {pick ? (
              <button type="button" onClick={linkToPick} disabled={mode === 'saving'} className="btn btn--primary">
                <span className="btn__inner">{mode === 'saving' ? 'Linking…' : `✓ Link ${alumniIds.length === 1 ? 'them' : `all ${alumniIds.length}`} to ${pick.name}`}</span>
              </button>
            ) : (
              <button type="button" onClick={createAndLink} disabled={mode === 'saving' || !draft.trim()} className="btn btn--neutral">
                <span className="btn__inner">{mode === 'saving' ? 'Creating…' : `+ Create “${toTitleCase(draft.trim()) || '…'}” as a new ${kind === 'colleges' ? 'college' : 'organisation'}`}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => { setMode('idle'); setDraft(display); setPick(null); setMessage(''); }}
              disabled={mode === 'saving'}
              className="btn btn--ghost"
            >
              <span className="btn__inner">Cancel</span>
            </button>
          </div>
          {message && <p className="alert alert--error" style={{ marginTop: 10 }}>{message}</p>}
        </div>
      )}
    </div>
  );
}
