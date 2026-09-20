'use client';

import React from 'react';
import { formatMonthYear } from '../../lib/text';
import { officialSchoolName } from '../../lib/options';
import { categoryForDegree } from '../../lib/types';
import type { AlumniRow, HigherStudyRow, WorkExperienceRow } from './adminData';
import { FIELD_LABELS } from './adminData';
import { splitStaged } from './editFields';

/**
 * One person, whole, as the school should see them before deciding.
 *
 * The old dashboard split a person in two: a registration showed the full
 * profile, while an edit to that same profile showed only a two-column diff of
 * the fields that changed - so nobody reviewing an edit could see what they
 * were changing it from, or anything else about the person.
 *
 * This is the profile, always, in the order a reader cares about: who they
 * are, what they tell juniors, where they went and how, what they are doing
 * now, then the private contact details the office needs and the public never
 * sees. When there are staged changes, each one is marked where it belongs -
 * in its own field, not in a separate table somewhere above.
 */

type Props = {
  person: AlumniRow;
  studies?: HigherStudyRow[];
  work?: WorkExperienceRow[];
  /** Present for an edit: what they want it to become. */
  staged?: Record<string, any> | null;
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** One field: what is live, and underneath it what they want instead. */
function Field({
  label, live, staged, has, wide, photo, note,
}: {
  label: string; live: unknown; staged?: Record<string, any> | null;
  has: string; wide?: boolean; photo?: boolean; note?: string | null;
}) {
  const proposed = staged && has in staged ? staged[has] : undefined;
  const changed = proposed !== undefined && proposed !== live && !(!proposed && !live);

  return (
    <div className={`pr-field${wide ? ' pr-field--wide' : ''}${changed ? ' pr-field--changed' : ''}`}>
      <span className="pr-field__label">{label}</span>
      {photo ? (
        <span className="pr-field__photos">
          <span className="pr-photo">
            {live ? <img src={String(live)} alt="" /> : <span className="pr-photo__none">No photo</span>}
            {changed && <span className="pr-photo__tag">Live now</span>}
          </span>
          {changed && (
            <span className="pr-photo pr-photo--new">
              {proposed ? <img src={String(proposed)} alt="" /> : <span className="pr-photo__none">Removing it</span>}
              <span className="pr-photo__tag">Proposed</span>
            </span>
          )}
        </span>
      ) : (
        <>
          <span className="pr-field__value">{show(live)}</span>
          {changed && (
            <span className="pr-field__new">
              <span aria-hidden>→ </span>{show(proposed)}
            </span>
          )}
          {note && <span className="pr-field__new">{note}</span>}
        </>
      )}
    </div>
  );
}

/**
 * "corrected from Engineering" - or nothing, when the stored area is simply
 * what the degree implies. Also silent when the degree tells us nothing, so
 * a hand-typed area on a Diploma is not reported as a correction.
 */
function correctedFrom(person: { degree?: string | null; branch?: string | null; professional_course?: string | null; field?: string | null }): string | null {
  const guess = categoryForDegree(person.degree, person.branch, person.professional_course);
  const stored = (person.field ?? '').trim();
  if (!guess || !stored || guess.label === stored) return null;
  return `corrected from ${guess.label}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pr-section">
      <h4 className="pr-section__title">{title}</h4>
      <div className="pr-grid">{children}</div>
    </section>
  );
}

export default function ProfileReview({ person, studies, work, staged }: Props) {
  const unknown = staged ? splitStaged(staged).unknown : [];
  const stagedStudies = staged && Array.isArray(staged.higher_studies) ? staged.higher_studies : null;
  const stagedWork = staged && Array.isArray(staged.work_experience) ? staged.work_experience : null;

  return (
    <div className="pr">
      <header className="pr__head">
        <span className="avatar avatar--lg" aria-hidden>
          {person.photo_url
            ? <img src={person.photo_url} alt="" />
            : (person.full_name?.charAt(0) ?? '?')}
        </span>
        <div>
          <h3 className="pr__name">{person.full_name}</h3>
          <p className="pr__meta">
            {[
              person.class_of ? `Class of ${person.class_of}` : null,
              person.stream,
              person.school_name ? officialSchoolName(person.school_name) : null,
            ].filter(Boolean).join(' · ')}
          </p>
          <div className="pr__badges">
            {person.consent_given === false && <span className="badge badge--xs">added by the school</span>}
            {person.personal_email && !person.email_verified_at && (
              <span className="badge badge--xs" title="They have not opened the confirmation link">email unconfirmed</span>
            )}
            {!person.user_id && <span className="badge badge--xs">no login yet</span>}
            {person.last_confirmed_at && (
              <span className="badge badge--xs">confirmed {formatMonthYear(person.last_confirmed_at)}</span>
            )}
          </div>
        </div>
      </header>

      {unknown.length > 0 && (
        <div className="diff-unknown">
          <p className="diff-unknown__head">Not recognised — these will not be published</p>
          <ul>
            {unknown.map(([key, value]) => (
              <li key={key}><code>{key}</code> <span>{JSON.stringify(value)}</span></li>
            ))}
          </ul>
          <p className="diff-unknown__note">
            The profile editor never sets these, so nothing here reaches the directory.
            If it keeps happening, tell whoever maintains the site.
          </p>
        </div>
      )}

      <Section title="What they would tell a junior">
        <Field label={FIELD_LABELS.message_1} live={person.message_1} staged={staged} has="message_1" wide />
        <Field label={FIELD_LABELS.message_2} live={person.message_2} staged={staged} has="message_2" wide />
        <Field label={FIELD_LABELS.college_thoughts} live={person.college_thoughts} staged={staged} has="college_thoughts" wide />
      </Section>

      <Section title="Where they went, and how">
        <Field label="College" live={person.college_name_raw} staged={staged} has="college_name_raw" />
        <Field label="Degree" live={person.degree} staged={staged} has="degree" />
        <Field label="Branch" live={person.branch} staged={staged} has="branch" />
        {/* The area of study is worked out from the degree unless somebody
            disagreed with it, so recomputing the guess here tells you which
            one this is. No column and no migration: the answer is already in
            the row. */}
        <Field label="Field" live={person.field} staged={staged} has="field" note={correctedFrom(person)} />
        <Field label="Admission route" live={person.admission_route} staged={staged} has="admission_route" />
        <Field label="Rank" live={person.admission_rank} staged={staged} has="admission_rank" />
        <Field label="Board marks" live={person.board_marks} staged={staged} has="board_marks" />
        <Field label="Cutoff" live={person.board_cutoff} staged={staged} has="board_cutoff" />
      </Section>

      {(person.professional_course || staged?.professional_course) && (
        <Section title="Professional qualification">
          <Field label="Course" live={person.professional_course} staged={staged} has="professional_course" />
          <Field label="Stage" live={person.professional_stage} staged={staged} has="professional_stage" />
          <Field label="Articling / studying at" live={person.professional_org} staged={staged} has="professional_org" />
        </Section>
      )}

      <Section title="What they are doing now">
        <Field label="Status" live={person.current_status} staged={staged} has="current_status" />
        <Field label="Expected to finish" live={person.expected_finish_year} staged={staged} has="expected_finish_year" />
        <Field label="Currently at" live={person.currently_at} staged={staged} has="currently_at" />
        <Field label="Role" live={person.designation} staged={staged} has="designation" />
      </Section>

      {(studies?.length || work?.length || stagedStudies || stagedWork) ? (
        <Section title="Their journey so far">
          <Timeline
            label="Higher studies" wide
            rows={(studies ?? []).map((s) => `🎓 ${s.degree_name}${s.institution ? ` — ${s.institution}` : ''}${(s.start_year || s.finish_year) ? ` (${s.start_year || '?'}–${s.finish_year || '?'})` : ''}`)}
            proposed={stagedStudies?.map((s: any) => `🎓 ${s.degree_name}${s.institution ? ` — ${s.institution}` : ''}${(s.start_year || s.finish_year) ? ` (${s.start_year || '?'}–${s.finish_year || '?'})` : ''}`)}
          />
          <Timeline
            label="Work" wide
            rows={(work ?? []).map((w) => `💼 ${w.role ? `${w.role} — ` : ''}${w.company}${(w.start_year || w.end_year) ? ` (${w.start_year || '?'}–${w.is_current ? 'now' : (w.end_year || '?')})` : ''}`)}
            proposed={stagedWork?.map((w: any) => `💼 ${w.role ? `${w.role} — ` : ''}${w.company}${(w.start_year || w.end_year) ? ` (${w.start_year || '?'}–${w.is_current ? 'now' : (w.end_year || '?')})` : ''}`)}
          />
        </Section>
      ) : null}

      <Section title="Picture and links">
        <Field label="Photo" live={person.photo_url} staged={staged} has="photo_url" wide photo />
        <Field label="LinkedIn" live={person.linkedin_url} staged={staged} has="linkedin_url" wide />
      </Section>

      <Section title="Private — the office only">
        <Field label="Email" live={person.personal_email} staged={staged} has="personal_email" />
        <Field
          label="Phone"
          live={person.phone_number ? `${person.phone_country_code ?? ''} ${person.phone_number}`.trim() : null}
          staged={staged} has="phone_number"
        />
        <Field label="Admission number" live={person.admission_number} staged={staged} has="admission_number" />
        <Field label="School" live={person.school_name ? officialSchoolName(person.school_name) : null} staged={staged} has="school_name" />
      </Section>
    </div>
  );
}

/**
 * Study or work entries. These are stored as whole lists, so a change is a
 * replacement of the lot - said plainly rather than implied, with what is
 * added, dropped or untouched marked line by line.
 */
function Timeline({
  label, rows, proposed, wide,
}: { label: string; rows: string[]; proposed?: string[]; wide?: boolean }) {
  const changing = !!proposed && (proposed.length !== rows.length || proposed.some((p, i) => p !== rows[i]));
  if (!rows.length && !proposed?.length) return null;

  return (
    <div className={`pr-field${wide ? ' pr-field--wide' : ''}${changing ? ' pr-field--changed' : ''}`}>
      <span className="pr-field__label">{label}</span>
      {rows.length === 0 ? <span className="pr-field__value">—</span> : (
        <ul className="pr-list">
          {rows.map((r) => (
            <li key={r} className={changing && !proposed!.includes(r) ? 'pr-list__gone' : undefined}>{r}</li>
          ))}
        </ul>
      )}
      {changing && (
        <>
          <span className="pr-field__new">→ replacing the list with these {proposed!.length}</span>
          <ul className="pr-list pr-list--new">
            {proposed!.map((r) => (
              <li key={r} className={rows.includes(r) ? undefined : 'pr-list__added'}>{r}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
