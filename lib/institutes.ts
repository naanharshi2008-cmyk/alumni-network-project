import { supabase } from './supabaseClient';
import { instKey } from './instituteKey';
import type { EntityHit, InstituteKind } from './EntitySearchField';

/** What the forms keep about a picked suggestion (serialisable, so drafts keep it). */
export type InstitutePick = { id: string; name: string } | null;

export function toPick(hit: EntityHit | null): InstitutePick {
  return hit ? { id: hit.id, name: hit.name } : null;
}

/**
 * The institute id to store for what someone typed.
 *
 * A picked suggestion wins, as long as the text still names it. Otherwise the
 * database resolves the text, and only when exactly one institute has that name
 * or alias - an ambiguous or unknown name returns null and goes to the admin's
 * unmatched queue rather than being linked to the wrong place.
 */
export async function linkFor(kind: InstituteKind, typed: string | null | undefined, pick: InstitutePick): Promise<string | null> {
  const text = (typed ?? '').trim();
  if (!text) return null;
  if (pick && instKey(pick.name) === instKey(text)) return pick.id;
  const { data, error } = await supabase.rpc('resolve_institute', { p_kind: kind, p_text: text });
  if (error) return null;
  return (data as string | null) ?? null;
}
