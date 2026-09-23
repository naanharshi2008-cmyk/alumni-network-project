'use client';

/**
 * "Got a seat anywhere else?" - the offers someone had and did not take.
 *
 * Collapsed, because most people have none worth listing and the form is long
 * enough. But the ones who do carry the most useful fact on the site for a
 * junior choosing between two colleges: a senior who was offered both.
 * Offers the school recorded are shown, read-only - they are the school's to
 * change.
 */

import { useRef } from 'react';
import EntitySearchField from '../EntitySearchField';
import { toPick } from '../institutes';
import { ADMISSION_KINDS } from '../admission';
import OptionSearchField from '../OptionSearchField';
import type { AdmissionKind } from '../types';
import { ChipRow, OptionalBlock, SelectBox } from './controls';
import { contextualBranchAliases, newAdmit, type AdmitDraft } from './model';

export default function AdmitsField({
  admits, onChange, open, onToggle, degreeOptions, branchOptions, branchAliases, examOptions, examAliases, schoolAdded = [],
}: {
  admits: AdmitDraft[];
  /** An update applied to the parent's latest list, never this render's copy. */
  onChange: (update: (prev: AdmitDraft[]) => AdmitDraft[]) => void;
  open: boolean;
  onToggle: (v: boolean) => void;
  degreeOptions: string[];
  branchOptions: string[];
  branchAliases: Record<string, string>;
  examOptions: string[];
  examAliases: Record<string, string>;
  /** Offers the school recorded, as lines to show and not edit. */
  schoolAdded?: string[];
}) {
  // With nothing entered yet there is still one empty row to type in. Its key
  // is kept across renders, so the row it becomes is the same element and the
  // cursor stays where it was.
  const blank = useRef<AdmitDraft>(newAdmit());
  const rows = admits.length ? admits : [blank.current];
  const set = (d: AdmitDraft, p: Partial<AdmitDraft>) => onChange((prev) => (
    prev.some((x) => x.key === d.key)
      ? prev.map((x) => (x.key === d.key ? { ...x, ...p } : x))
      : [...prev, { ...d, ...p }]
  ));

  return (
    <OptionalBlock
      title="Got a seat anywhere else?"
      caption={admits.some((d) => d.college.trim()) || schoolAdded.length
        ? `${admits.filter((d) => d.college.trim()).length + schoolAdded.length} other offer(s)`
        : 'offers you had and did not take — optional'}
      open={open} onToggle={onToggle}
    >
      {schoolAdded.length > 0 && (
        <div className="form-note">
          Recorded by the school: {schoolAdded.join('; ')}. Ask the office if any of these is wrong.
        </div>
      )}
      {/* Round 11: an offer that came through an entrance exam is asked with
          that exam, where the route needs no asking. This block is for the
          rest - an offer on board marks, a direct admission - which is most of
          them, and which nothing else on the form could hold. */}
      <p className="form-note" style={{ marginTop: 0 }}>
        An offer that came through an entrance exam is easiest to add with that exam, above.
      </p>
      {rows.map((d) => (
        <div key={d.key} className="entry-card">
          <EntitySearchField
            kind="college" label="College" hint="short names work — “PSG Tech”, “VIT Chennai”"
            value={d.college}
            onChange={(college) => set(d, { college, pick: null })}
            onSelect={(hit) => set(d, hit ? { college: hit.name, pick: toPick(hit) } : { pick: null })}
          />
          <div className="two-col">
            <SelectBox
              label="Degree" value={d.degree} placeholder="Select…"
              options={degreeOptions.filter((o) => o !== 'Other')}
              onChange={(degree) => set(d, { degree })}
            />
            <OptionSearchField
              label="Branch" options={branchOptions} aliases={branchAliases} extra={contextualBranchAliases(d.degree)}
              value={d.branch}
              onChange={(branch) => set(d, { branch })}
            />
          </div>
          <div className="field">
            <label>How was it offered? <span className="opt">optional</span></label>
            <ChipRow<AdmissionKind>
              label="How was it offered?"
              options={ADMISSION_KINDS.map((k) => ({ value: k.key, label: k.label }))}
              value={d.kind}
              onChange={(kind) => set(d, { kind })}
            />
          </div>
          {d.kind === 'entrance_exam' && (
            <OptionSearchField
              label="Through which exam?" options={examOptions} aliases={examAliases}
              value={d.exam}
              onChange={(exam) => set(d, { exam })}
            />
          )}
          {admits.length > 0 && (
            <button
              type="button" className="btn btn--ghost" style={{ marginTop: 8 }}
              onClick={() => onChange((prev) => prev.filter((x) => x.key !== d.key))}
            >
              <span className="btn__inner">Remove</span>
            </button>
          )}
        </div>
      ))}
      <button type="button" className="btn btn--ghost btn--block" onClick={() => onChange((prev) => [...(prev.length ? prev : [blank.current]), newAdmit()])}>
        <span className="btn__inner">+ Add another offer</span>
      </button>
    </OptionalBlock>
  );
}
