'use client';

import React from 'react';
import { formatMonthYear } from '../../lib/text';
import { officialSchoolName } from '../../lib/options';
import { categoryForDegree } from '../../lib/types';
import { admissionOf, labelOfShape } from '../../lib/admission';
import { linkedinUrl } from '../../lib/linkedin';
import type { AdminAdmitRow, AdminAttemptRow, AdminGapRow, AdminPath, AlumniRow, HigherStudyRow, WorkExperienceRow } from './adminData';
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

/**
 * Which staged fields the school has ticked to publish.
 *
 * Publishing used to be all-or-nothing: one button took the whole blob, so an
 * edit with one good change and one the office wanted to query had to be
 * discarded entirely and re-typed by the alumnus. Ticking happens on the field
 * itself, where the change is shown, rather than in a list somewhere else.
 */
export type Picks = {
  has: (key: string) => boolean;
  toggle: (key: string) => void;
};

type Props = {
  person: AlumniRow;
  studies?: HigherStudyRow[];
  work?: WorkExperienceRow[];
  /** Present for an edit: what they want it to become. */
  staged?: Record<string, any> | null;
  /** Present for an edit the school is about to publish some of. */
  picks?: Picks | null;
  /** Exams, offers, gap years, family and the office note (migration 18). */
  path?: AdminPath;
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** One field: what is live, and underneath it what they want instead. */
function Field({
  label, live, staged, has, wide, photo, note, picks, tickKey,
}: {
  label: string; live: unknown; staged?: Record<string, any> | null;
  has: string; wide?: boolean; photo?: boolean; note?: string | null;
  picks?: Picks | null;
  /** The key the tick publishes, when the value shown is worked out from it. */
  tickKey?: string;
}) {
  const proposed = staged && has in staged ? staged[has] : undefined;
  const changed = proposed !== undefined && proposed !== live && !(!proposed && !live);
  const ticked = !!picks && picks.has(tickKey ?? has);

  return (
    <div className={`pr-field${wide ? ' pr-field--wide' : ''}${changed ? ' pr-field--changed' : ''}${changed && picks && !ticked ? ' pr-field--held' : ''}`}>
      <span className="pr-field__label">
        {changed && picks ? (
          <label className="pr-tick">
            <input type="checkbox" checked={ticked} onChange={() => picks.toggle(tickKey ?? has)} />
            <span>{label}</span>
          </label>
        ) : label}
      </span>
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

/* The path lists, one line each. Exact ranks: this is the school's screen. */
function attemptLine(t: Partial<AdminAttemptRow>): string {
  const outcome = t.got_seat ? ' — the seat' : t.gave_admit === true ? ' — offer' : t.gave_admit === false ? ' — no offer' : '';
  return `📝 ${t.exam}${t.exam_year ? ` ${t.exam_year}` : ''}${outcome}${t.exam_rank ? ` · rank ${t.exam_rank}` : ''}`;
}
function admitLine(d: Partial<AdminAdmitRow>): string {
  const course = [d.degree, d.branch].filter(Boolean).join(' ');
  const where = d.college?.name ?? d.college_name_raw ?? '';
  const how = labelOfShape({ kind: d.route_kind ?? null, exam: d.exam ?? null, detail: d.route_detail ?? null });
  return `🎓 ${[course, where].filter(Boolean).join(' at ')}${how ? ` (${how})` : ''}`;
}
function gapLine(g: Partial<AdminGapRow>): string {
  return g.kind === 'break'
    ? `🌱 ${g.gap_year} — a year out`
    : `📚 ${g.gap_year} — preparing${g.exam ? ` for ${g.exam}` : ''}${g.coaching_name_raw ? ` with ${g.coaching_name_raw}` : ''}`;
}
function parentLine(p: Record<string, any> | null | undefined, n: 1 | 2): string | null {
  if (!p) return null;
  const name = p[`guardian${n}_name`];
  if (!name) return null;
  const phone = p[`guardian${n}_phone`] ? `${p[`guardian${n}_phone_code`] ?? ''} ${p[`guardian${n}_phone`]}`.trim() : null;
  return [p[`guardian${n}_relation`], name, phone].filter(Boolean).join(' · ');
}

export default function ProfileReview({ person, studies, work, staged, picks, path }: Props) {
  const unknown = staged ? splitStaged(staged).unknown : [];
  const stagedStudies = staged && Array.isArray(staged.higher_studies) ? staged.higher_studies : null;
  const stagedWork = staged && Array.isArray(staged.work_experience) ? staged.work_experience : null;
  const stagedAttempts = staged && Array.isArray(staged.exam_attempts) ? staged.exam_attempts : null;
  const stagedAdmits = staged && Array.isArray(staged.admits) ? staged.admits : null;
  const stagedGaps = staged && Array.isArray(staged.gap_years) ? staged.gap_years : null;
  const ownAdmits = (path?.admits ?? []).filter((d) => !d.added_by_school);
  const schoolAdmits = (path?.admits ?? []).filter((d) => d.added_by_school);

  // How they got in, as one line, live and proposed - the kind, its exam and
  // its detail are published together (GROUPED_KEYS in editFields.ts).
  const liveHow = labelOfShape(admissionOf(person));
  const hasNewHow = !!staged && ['admission_kind', 'admission_exam', 'admission_detail'].some((k) => k in staged);
  const derived: Record<string, any> = { ...(staged ?? {}) };
  if (hasNewHow) {
    derived.__how = labelOfShape({
      kind: 'admission_kind' in staged! ? staged!.admission_kind : person.admission_kind ?? null,
      exam: 'admission_exam' in staged! ? staged!.admission_exam : person.admission_exam ?? null,
      detail: 'admission_detail' in staged! ? staged!.admission_detail : person.admission_detail ?? null,
    });
  } else if (staged && 'admission_route' in staged) {
    derived.__how = labelOfShape(admissionOf({ admission_route: staged.admission_route }));
  }
  if (staged && 'linkedin_handle' in staged) derived.__linkedin = linkedinUrl(staged.linkedin_handle);
  else if (staged && 'linkedin_url' in staged) derived.__linkedin = staged.linkedin_url;

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
            {person.origin === 'import' && <span className="badge badge--xs">imported</span>}
            {person.in_gap_year && <span className="badge badge--xs" title="Unlisted until they say where they joined">in a year out</span>}
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

      <Section title="In their words">
        <Field label={FIELD_LABELS.message_1} live={person.message_1} staged={staged} has="message_1" wide picks={picks} />
        <Field label={FIELD_LABELS.message_2} live={person.message_2} staged={staged} has="message_2" wide picks={picks} />
        <Field label={FIELD_LABELS.college_thoughts} live={person.college_thoughts} staged={staged} has="college_thoughts" wide picks={picks} />
      </Section>

      <Section title="Where they went, and how">
        <Field label="College" live={person.college_name_raw} staged={staged} has="college_name_raw" picks={picks} />
        <Field label="Degree" live={person.degree} staged={staged} has="degree" picks={picks} />
        <Field label="Branch" live={person.branch} staged={staged} has="branch" picks={picks} />
        {/* The area of study is worked out from the degree unless somebody
            disagreed with it, so recomputing the guess here tells you which
            one this is. No column and no migration: the answer is already in
            the row. */}
        <Field label="Field" live={person.field} staged={staged} has="field" note={correctedFrom(person)} picks={picks} />
        <Field
          label="How they got in" live={liveHow} staged={derived} has="__how" picks={picks}
          tickKey={hasNewHow ? 'admission_kind' : 'admission_route'}
        />
        <Field label="In a year out" live={!!person.in_gap_year} staged={staged} has="in_gap_year" picks={picks} />
        <Field label="Rank" live={person.admission_rank} staged={staged} has="admission_rank" picks={picks} />
        <Field label="Board marks" live={person.board_marks} staged={staged} has="board_marks" picks={picks} />
        <Field label="Cutoff" live={person.board_cutoff} staged={staged} has="board_cutoff" picks={picks} />
      </Section>

      {(person.professional_course || staged?.professional_course) && (
        <Section title="Professional qualification">
          <Field label="Course" live={person.professional_course} staged={staged} has="professional_course" picks={picks} />
          <Field label="Stage" live={person.professional_stage} staged={staged} has="professional_stage" picks={picks} />
          <Field label="Articling / studying at" live={person.professional_org} staged={staged} has="professional_org" picks={picks} />
        </Section>
      )}

      <Section title="What they are doing now">
        <Field label="Status" live={person.current_status} staged={staged} has="current_status" picks={picks} />
        <Field label="Expected to finish" live={person.expected_finish_year} staged={staged} has="expected_finish_year" picks={picks} />
        <Field label="Currently at" live={person.currently_at} staged={staged} has="currently_at" picks={picks} />
        <Field label="Role" live={person.designation} staged={staged} has="designation" picks={picks} />
      </Section>

      {(studies?.length || work?.length || stagedStudies || stagedWork) ? (
        <Section title="Their journey so far">
          <Timeline
            label="Higher studies" wide
            rows={(studies ?? []).map((s) => `🎓 ${s.degree_name}${s.institution ? ` — ${s.institution}` : ''}${(s.start_year || s.finish_year) ? ` (${s.start_year || '?'}–${s.finish_year || '?'})` : ''}`)}
            proposed={stagedStudies?.map((s: any) => `🎓 ${s.degree_name}${s.institution ? ` — ${s.institution}` : ''}${(s.start_year || s.finish_year) ? ` (${s.start_year || '?'}–${s.finish_year || '?'})` : ''}`)}
            picks={picks} has="higher_studies"
          />
          <Timeline
            label="Work" wide
            rows={(work ?? []).map((w) => `💼 ${w.role ? `${w.role} — ` : ''}${w.company}${(w.start_year || w.end_year) ? ` (${w.start_year || '?'}–${w.is_current ? 'now' : (w.end_year || '?')})` : ''}`)}
            proposed={stagedWork?.map((w: any) => `💼 ${w.role ? `${w.role} — ` : ''}${w.company}${(w.start_year || w.end_year) ? ` (${w.start_year || '?'}–${w.is_current ? 'now' : (w.end_year || '?')})` : ''}`)}
            picks={picks} has="work_experience"
          />
        </Section>
      ) : null}

      {(path?.attempts.length || path?.admits.length || path?.gapYears.length
        || stagedAttempts || stagedAdmits || stagedGaps) ? (
        <Section title="Exams, offers and a year out">
          <Timeline
            label="Exams written" wide
            rows={[...(path?.attempts ?? [])].sort((x, y) => Number(y.got_seat) - Number(x.got_seat)).map(attemptLine)}
            proposed={stagedAttempts?.map(attemptLine)}
            picks={picks} has="exam_attempts"
          />
          <Timeline
            label="Offers not taken" wide
            rows={ownAdmits.map(admitLine)}
            proposed={stagedAdmits?.map(admitLine)}
            picks={picks} has="admits"
          />
          {schoolAdmits.length > 0 && (
            <div className="pr-field pr-field--wide">
              <span className="pr-field__label">Offers the school recorded</span>
              <ul className="pr-list">{schoolAdmits.map((d) => <li key={d.id}>{admitLine(d)}</li>)}</ul>
            </div>
          )}
          <Timeline
            label="Gap years" wide
            rows={(path?.gapYears ?? []).map(gapLine)}
            proposed={stagedGaps?.map(gapLine)}
            picks={picks} has="gap_years"
          />
        </Section>
      ) : null}

      <Section title="Picture and links">
        <Field label="Photo" live={person.photo_url} staged={staged} has="photo_url" wide photo picks={picks} />
        <Field
          label="LinkedIn" live={person.linkedin_url} staged={derived} has="__linkedin" wide picks={picks}
          tickKey={staged && 'linkedin_handle' in staged ? 'linkedin_handle' : 'linkedin_url'}
        />
      </Section>

      <Section title="Private — the office only">
        <Field label="Email" live={person.personal_email} staged={staged} has="personal_email" picks={picks} />
        <Field
          label="Phone"
          live={person.phone_number ? `${person.phone_country_code ?? ''} ${person.phone_number}`.trim() : null}
          staged={staged} has="phone_number" picks={picks}
        />
        <Field label="Admission number" live={person.admission_number} staged={staged} has="admission_number" picks={picks} />
        <Field label="School" live={person.school_name ? officialSchoolName(person.school_name) : null} staged={staged} has="school_name" picks={picks} />
        {/* Saved live by the person and never published, so there is nothing
            to approve here - only to know. */}
        <Field label="Parent or guardian" live={parentLine(path?.private, 1)} has="__none" />
        {parentLine(path?.private, 2) && <Field label="Second parent" live={parentLine(path?.private, 2)} has="__none" />}
        <Field
          label="Home" wide has="__none"
          live={path?.private
            ? [path.private.address_line, path.private.town, path.private.district, path.private.state, path.private.pin].filter(Boolean).join(', ') || null
            : null}
        />
        {path?.officeNote && <Field label="Office note" live={path.officeNote} has="__none" wide />}
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
  label, rows, proposed, wide, picks, has,
}: {
  label: string; rows: string[]; proposed?: string[]; wide?: boolean;
  picks?: Picks | null; has?: string;
}) {
  const changing = !!proposed && (proposed.length !== rows.length || proposed.some((p, i) => p !== rows[i]));
  if (!rows.length && !proposed?.length) return null;
  const ticked = !!picks && !!has && picks.has(has);

  return (
    <div className={`pr-field${wide ? ' pr-field--wide' : ''}${changing ? ' pr-field--changed' : ''}${changing && picks && !ticked ? ' pr-field--held' : ''}`}>
      <span className="pr-field__label">
        {changing && picks && has ? (
          <label className="pr-tick">
            <input type="checkbox" checked={ticked} onChange={() => picks.toggle(has)} />
            <span>{label}</span>
          </label>
        ) : label}
      </span>
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
