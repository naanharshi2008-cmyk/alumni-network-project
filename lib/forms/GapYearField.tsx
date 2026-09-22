'use client';

/**
 * "Right after Class 12, did you join a college?"
 *
 * About one in twenty of the school's respondents was taking a year to try
 * again - "Neet repeater", "Neet preparation" typed into whatever box was
 * nearest, because the form had no honest place for it. Some take a year for
 * reasons that have nothing to do with an exam. Both are paths, and both are
 * asked here, plainly.
 *
 * While the year is current the profile stays unlisted (the owner's decision):
 * juniors see only a count per area, never a name. Once they say where they
 * joined, the year shows on their page as part of the path.
 */

import OptionSearchField from '../OptionSearchField';
import { ChipQuestion, TextField } from './controls';
import type { GapDraft } from './model';

export default function GapYearField({
  value, onChange, examOptions, examAliases, error, touched,
}: {
  value: GapDraft;
  /** A patch, merged by the parent into its latest state (see FamilyHomeFields). */
  onChange: (patch: Partial<GapDraft>) => void;
  examOptions: string[];
  examAliases: Record<string, string>;
  error?: string;
  touched?: boolean;
}) {
  const set = onChange;
  const showError = touched ? error : '';
  const gap = value.afterSchool === 'gap';

  return (
    <div className="gap-year" data-field="gap">
      <ChipQuestion<'joined' | 'gap' | 'other'>
        label="Right after Class 12, did you join a college?" required
        options={[
          { value: 'joined', label: 'Yes' },
          { value: 'gap', label: 'No, I took a year' },
          { value: 'other', label: 'Something else — CA, work…' },
        ]}
        value={value.afterSchool}
        onChange={(afterSchool) => set({ afterSchool })}
        error={!value.afterSchool ? showError : ''}
      />

      {gap && (
        <>
          <ChipQuestion<'preparing' | 'break'>
            label="What was the year for?" required
            options={[{ value: 'preparing', label: 'Preparing for an exam' }, { value: 'break', label: 'A break' }]}
            value={value.kind}
            onChange={(kind) => set({ kind })}
            error={!value.kind ? showError : ''}
          />

          {value.kind === 'preparing' && (
            <div className="two-col">
              <OptionSearchField
                label="Which exam?" options={examOptions} aliases={examAliases}
                value={value.exam} onChange={(exam) => set({ exam })}
                hint="NEET, JEE…"
              />
              <TextField
                label="Coaching centre" optional
                value={value.coaching} onChange={(coaching) => set({ coaching })}
                hint="if you went to one"
              />
            </div>
          )}

          <ChipQuestion<'yes' | 'no'>
            label="Have you joined a college since?" required
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'Not yet' }]}
            value={value.joinedSince}
            onChange={(joinedSince) => set({ joinedSince })}
            error={value.kind && !value.joinedSince ? showError : ''}
          />

          {value.joinedSince === 'no' && (
            <p className="form-note form-note--warm" role="status">
              Your page stays private until you tell us where you joined — come back and add it
              then. Until that day juniors only ever see how many are preparing, never who.
            </p>
          )}
        </>
      )}
    </div>
  );
}
