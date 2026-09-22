'use client';

/**
 * "How did you get this seat?" - four ways in, then only what that way needs.
 *
 * The school's own form asked which exams a student applied for and never how
 * they got in, so nearly half the class ticked "None of the above" and the
 * sheet cannot say whether they joined on marks or on a management seat. And
 * it listed TNEA beside JEE, teaching students that counselling on marks is
 * an exam. This asks the one question first, in the words the owner chose,
 * and never the word "quota".
 */

import { ADMISSION_KINDS } from '../admission';
import { isTnea } from '../exams';
import OptionSearchField from '../OptionSearchField';
import type { AdmissionKind } from '../types';
import { ChipQuestion, TextField } from './controls';
import type { AdmissionDraft } from './model';

export default function AdmissionFields({
  value, onChange, examOptions, examAliases, error, required, touched,
}: {
  value: AdmissionDraft;
  /** A patch, merged by the parent into its latest state (see FamilyHomeFields). */
  onChange: (patch: Partial<AdmissionDraft>) => void;
  examOptions: string[];
  examAliases: Record<string, string>;
  /** The step's message for this block, from admissionProblem(). */
  error?: string;
  required?: boolean;
  touched?: boolean;
}) {
  const set = onChange;
  const kindHint = ADMISSION_KINDS.find((k) => k.key === value.kind)?.hint;
  const typedTnea = value.kind === 'entrance_exam' && isTnea(value.exam);
  const showError = touched ? error : '';

  return (
    <div className="admission-fields" data-field="admission">
      <ChipQuestion<AdmissionKind>
        label="How did you get this seat?" required={required}
        options={ADMISSION_KINDS.map((k) => ({ value: k.key, label: k.label }))}
        value={value.kind}
        onChange={(kind) => set({ kind })}
        hint={kindHint}
        error={!value.kind ? showError : ''}
      />

      {value.kind === 'board_marks' && (
        <>
          <ChipQuestion<'yes' | 'no'>
            label="Through TNEA counselling?"
            options={[{ value: 'yes', label: 'Yes, TNEA' }, { value: 'no', label: 'No' }]}
            value={value.tnea}
            onChange={(tnea) => set({ tnea })}
            hint="TNEA is Tamil Nadu’s engineering counselling on your Class 12 marks."
          />
          <div className="two-col">
            <TextField
              label="Board marks (%)" optional type="number" inputMode="decimal"
              value={value.marks} onChange={(marks) => set({ marks })}
              hint="shown only as a range"
            />
            {value.tnea === 'yes' && (
              <TextField
                label="TNEA cutoff" optional inputMode="decimal"
                value={value.cutoff} onChange={(cutoff) => set({ cutoff })} hint="out of 200"
              />
            )}
          </div>
        </>
      )}

      {value.kind === 'entrance_exam' && (
        <>
          <OptionSearchField
            name="admission_exam" label="Which exam got you the seat?" required
            options={examOptions} aliases={examAliases}
            value={value.exam} onChange={(exam) => set({ exam })}
            hint="JEE Main, NEET, AMRITAEEE, CUET…"
            error={value.kind === 'entrance_exam' && !typedTnea && showError && !value.exam.trim() ? showError : ''}
          />
          {typedTnea && (
            <p className="form-note form-note--warn" role="status">
              TNEA is counselling on your marks, not an entrance exam.{' '}
              <button
                type="button" className="link-btn"
                onClick={() => set({ kind: 'board_marks', tnea: 'yes', exam: '' })}
              >
                Choose board marks (TNEA)
              </button>
            </p>
          )}
          {!typedTnea && (
            <TextField
              label={value.exam.trim() ? `${value.exam.trim()} rank` : 'Rank'} optional inputMode="numeric"
              value={value.rank} onChange={(rank) => set({ rank: rank.replace(/[^\d]/g, '') })}
              hint="shown only as a range, never the exact number"
              error={showError && /rank/i.test(showError) ? showError : ''}
            />
          )}
        </>
      )}

      {value.kind === 'management' && (
        <p className="form-note">
          Shown on your page like any other way in — it is a real path, and juniors should know it exists.
        </p>
      )}

      {value.kind === 'other' && (
        <TextField
          label="In a few words" optional maxLength={120}
          value={value.other} onChange={(other) => set({ other })}
          hint="e.g. sports, lateral entry, a scholarship"
        />
      )}

      {(value.kind === 'board_marks' || value.kind === 'entrance_exam') && (
        <p className="form-note form-note--warm">
          An ordinary score helps a junior more than a top one — most want to know if someone like
          them got in. We only ever show a range, like &ldquo;Rank 10,000–25,000&rdquo;.
        </p>
      )}
    </div>
  );
}
