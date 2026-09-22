'use client';

/**
 * Family and home 🔒 - a parent or guardian, and the address.
 *
 * Private by construction: it is stored in alumni_private, which no view
 * publishes and anon cannot read (migration 18). It is never kept in the
 * browser's saved draft either - see registration's draft effect.
 *
 * "Father, mother or guardian?" is asked, not assumed: one respondent in the
 * school's sheet wrote their mother's number in the box labelled father.
 */

import { COUNTRY_CODES } from '../options';
import { ChipQuestion, SelectBox, TextField } from './controls';
import type { FamilyDraft, FamilyKey, Relation } from './model';

const RELATIONS: { value: Exclude<Relation, ''>; label: string }[] = [
  { value: 'Father', label: 'Father' }, { value: 'Mother', label: 'Mother' }, { value: 'Guardian', label: 'Guardian' },
];

export default function FamilyHomeFields({
  value, onChange, problems, touched, onTouch, studentPhone, required,
}: {
  value: FamilyDraft;
  /**
   * A patch, not the whole object: autofill fills street, town, state and PIN
   * in one go, and a handler that rebuilt the object from this render's value
   * would keep only the last of them. The parent merges it into its latest state.
   */
  onChange: (patch: Partial<FamilyDraft>) => void;
  /** From familyProblems(). */
  problems: Partial<Record<FamilyKey, string>>;
  touched: Partial<Record<FamilyKey, boolean>>;
  onTouch: (key: FamilyKey) => void;
  /** Their own number, to catch a parent's box filled with it. */
  studentPhone?: string;
  required?: boolean;
}) {
  const set = onChange;
  const err = (k: FamilyKey) => (touched[k] ? problems[k] : '') || '';
  const same = (p: string) => !!studentPhone && !!p.trim()
    && p.replace(/\D/g, '').slice(-10) === studentPhone.replace(/\D/g, '').slice(-10);

  return (
    <div className="family-home">
      <p className="form-note">
        🔒 Only you and the school office see this. It is never shown on your page.
      </p>

      <h3 className="step-subhead">Parent or guardian</h3>
      <TextField
        name="g1_name" label="Their name" required={required} autoComplete="off"
        value={value.g1_name} onChange={(g1_name) => set({ g1_name })} onBlur={() => onTouch('g1_name')}
        error={err('g1_name')}
      />
      <ChipQuestion<Exclude<Relation, ''>>
        name="g1_relation" label="They are your" required={required}
        options={RELATIONS} value={value.g1_relation}
        onChange={(g1_relation) => { set({ g1_relation }); onTouch('g1_relation'); }}
        error={err('g1_relation')}
      />
      <div className="two-col two-col--code">
        <SelectBox label="Code" value={value.g1_code} options={COUNTRY_CODES} onChange={(g1_code) => set({ g1_code })} />
        <TextField
          name="g1_phone" label="Their phone number" required={required} type="tel" inputMode="tel"
          value={value.g1_phone} onChange={(v) => set({ g1_phone: v.replace(/[^\d\s]/g, '') })}
          onBlur={() => onTouch('g1_phone')} error={err('g1_phone')}
          hint={same(value.g1_phone) ? 'this is your own number — is that right?' : undefined}
        />
      </div>

      {!value.g2_on ? (
        <button type="button" className="link-btn" onClick={() => set({ g2_on: true })}>+ Add a second parent</button>
      ) : (
        <div className="entry-card">
          <TextField
            name="g2_name" label="Second parent’s name" optional
            value={value.g2_name} onChange={(g2_name) => set({ g2_name })} onBlur={() => onTouch('g2_name')}
            error={err('g2_name')}
          />
          <ChipQuestion<Exclude<Relation, ''>>
            name="g2_relation" label="They are your"
            options={RELATIONS} value={value.g2_relation}
            onChange={(g2_relation) => { set({ g2_relation }); onTouch('g2_relation'); }}
            error={err('g2_relation')}
          />
          <div className="two-col two-col--code">
            <SelectBox label="Code" value={value.g2_code} options={COUNTRY_CODES} onChange={(g2_code) => set({ g2_code })} />
            <TextField
              name="g2_phone" label="Their phone number" optional type="tel" inputMode="tel"
              value={value.g2_phone} onChange={(v) => set({ g2_phone: v.replace(/[^\d\s]/g, '') })}
              onBlur={() => onTouch('g2_phone')} error={err('g2_phone')}
              hint={same(value.g2_phone) ? 'this is your own number — is that right?' : undefined}
            />
          </div>
          <button
            type="button" className="link-btn"
            onClick={() => set({ g2_on: false, g2_name: '', g2_relation: '', g2_phone: '' })}
          >
            Remove the second parent
          </button>
        </div>
      )}

      <h3 className="step-subhead">Home address</h3>
      <TextField
        name="address_line" label="House number and street" required={required} autoComplete="street-address"
        value={value.address_line} onChange={(address_line) => set({ address_line })}
        onBlur={() => onTouch('address_line')} error={err('address_line')}
      />
      <div className="two-col">
        <TextField
          name="town" label="Town or city" required={required} autoComplete="address-level2"
          value={value.town} onChange={(town) => set({ town })} onBlur={() => onTouch('town')} error={err('town')}
        />
        <TextField
          name="district" label="District" required={required}
          value={value.district} onChange={(district) => set({ district })} onBlur={() => onTouch('district')}
          error={err('district')}
        />
      </div>
      <div className="two-col">
        <TextField
          name="state" label="State" required={required} autoComplete="address-level1"
          value={value.state} onChange={(state) => set({ state })} onBlur={() => onTouch('state')} error={err('state')}
        />
        <TextField
          name="pin" label="PIN code" required={required} inputMode="numeric" autoComplete="postal-code" maxLength={6}
          value={value.pin} onChange={(v) => set({ pin: v.replace(/[^\d]/g, '') })} onBlur={() => onTouch('pin')}
          error={err('pin')}
        />
      </div>
    </div>
  );
}
