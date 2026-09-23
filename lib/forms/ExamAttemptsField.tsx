'use client';

/**
 * "Other entrance exams you wrote" - chips, most likely first, each opening a
 * one-line follow-up.
 *
 * A quarter of the school's form respondents wrote two or more exams, up to
 * six, and a list that says only which exam got the seat hides that JEE Main
 * was written by far more people than it placed. This keeps each extra exam
 * to a tap, with "did it give you an offer?" and an optional rank beside it -
 * compact to fill in, and compact to read back.
 */

import { useEffect, useRef, useState } from 'react';
import EntitySearchField from '../EntitySearchField';
import { EXAMS, examAreas, examCanonical, isTnea, normText } from '../exams';
import { toPick } from '../institutes';
import OptionSearchField from '../OptionSearchField';
import type { CategoryKey } from '../types';
import { ChipRow, SelectBox } from './controls';
import { contextualBranchAliases, newAttempt, newOffer, type AttemptDraft, type OfferDraft } from './model';

/** The exams the school's own students wrote most, for anyone whose area we cannot tell. */
const POPULAR = ['JEE Main', 'NEET', 'AMRITAEEE', 'VITEEE', 'SRMJEEE', 'CUET', 'JEE Advanced', 'BITSAT'];
const CHIP_COUNT = 8;

/**
 * The chips: their area's exams, then the school's most common. The seat's
 * own exam is left out - it is already ticked - except after a year out, when
 * the first try at it is an attempt of its own.
 */
function commonExams(area: CategoryKey | null, seat: string, tookGap: boolean): string[] {
  const inArea = area ? EXAMS.filter((e) => e.areas.includes(area)).map((e) => e.name) : [];
  const list = [...new Set([...inArea, ...POPULAR])].filter((e) => tookGap || normText(e) !== normText(seat));
  return list.slice(0, CHIP_COUNT);
}

export default function ExamAttemptsField({
  attempts, onChange, seatExam, area, examOptions, examAliases, classOf, tookGap,
  degreeOptions, branchOptions, branchAliases,
}: {
  attempts: AttemptDraft[];
  /** An update applied to the parent's latest list, never this render's copy. */
  onChange: (update: (prev: AttemptDraft[]) => AttemptDraft[]) => void;
  /** The exam their seat came through, shown ticked and fixed. */
  seatExam: string;
  /** Their course's area, so its exams come first. */
  area: CategoryKey | null;
  examOptions: string[];
  examAliases: Record<string, string>;
  classOf: number | null;
  /** A year out means an exam may have been written twice - the year is asked then. */
  tookGap: boolean;
  /**
   * For the offer asked inline when an exam gave one. Left out on a surface
   * that has no course vocabulary to hand, and then the offer is simply not
   * asked there - the "anywhere else?" block still takes it.
   */
  degreeOptions?: string[];
  branchOptions?: string[];
  branchAliases?: Record<string, string>;
}) {
  const [another, setAnother] = useState('');
  const [showAnother, setShowAnother] = useState(false);
  const anotherBox = useRef<HTMLDivElement>(null);
  // Revealed by a tap, so the cursor belongs in it - otherwise the box appears
  // somewhere below the thumb that opened it and has to be found again.
  useEffect(() => {
    if (showAnother) anotherBox.current?.querySelector('input')?.focus();
  }, [showAnother]);
  const seat = examCanonical(seatExam, examAliases) ?? seatExam.trim();
  const chips = commonExams(area, seat, tookGap);
  const has = (exam: string) => attempts.some((t) => normText(t.exam) === normText(exam));

  function toggle(exam: string) {
    if (has(exam)) onChange((prev) => prev.filter((t) => normText(t.exam) !== normText(exam)));
    else onChange((prev) => [...prev, newAttempt(exam)]);
  }
  function addAnother() {
    const typed = another.trim();
    if (!typed || isTnea(typed)) return;
    const exam = examCanonical(typed, examAliases) ?? typed;
    if (!has(exam) && (tookGap || normText(exam) !== normText(seat))) onChange((prev) => [...prev, newAttempt(exam)]);
    setAnother('');
  }
  const patch = (key: string, p: Partial<AttemptDraft>) =>
    onChange((prev) => prev.map((t) => (t.key === key ? { ...t, ...p } : t)));
  const patchOffer = (t: AttemptDraft, p: Partial<OfferDraft>) =>
    patch(t.key, { offer: { ...(t.offer ?? newOffer()), ...p } });

  // Exams ticked that are not among the chips still need a chip to untick.
  const extraTicked = attempts.filter((t) => !chips.some((c) => normText(c) === normText(t.exam)));
  const years = classOf ? [String(classOf), String(classOf + 1)] : [];

  return (
    <div className="field exam-attempts">
      <label>Other entrance exams you wrote <span className="opt">optional</span></label>
      <p className="hint" style={{ display: 'block', margin: '0 0 8px' }}>
        Tap each one — not only the one that got you in. Juniors learn as much from the others.
      </p>

      <div className="chips chips--wrap">
        {seat && (
          <span className="chip chip--active chip--fixed" title="The exam your seat came through">
            ✓ {seat} <span className="chip__sub">your seat</span>
          </span>
        )}
        {chips.map((exam) => (
          <button
            key={exam} type="button" aria-pressed={has(exam)}
            className={`chip${has(exam) ? ' chip--active' : ''}`} onClick={() => toggle(exam)}
          >
            {has(exam) ? '✓ ' : ''}{exam}{tookGap && normText(exam) === normText(seat) ? ' (first try)' : ''}
          </button>
        ))}
        {extraTicked.map((t) => (
          <button key={t.key} type="button" aria-pressed className="chip chip--active" onClick={() => toggle(t.exam)}>
            ✓ {t.exam} <span aria-hidden>×</span><span className="sr-only"> (remove)</span>
          </button>
        ))}
      </div>

      {/* The chips are the interface. The typing box is the way out for an exam
          they do not cover, and used to sit open under them - asking a question
          nobody had asked for, which is exactly what the school's own form did
          with its required "any other exam" box and got 90 answers of "No". */}
      {showAnother ? (
        <div className="exam-attempts__another" ref={anotherBox}>
          <OptionSearchField
            label="Another exam" options={examOptions} aliases={examAliases}
            value={another} onChange={setAnother}
            hint={isTnea(another) ? 'TNEA is counselling on marks, not an exam — no need to add it here.' : 'type it, then tap Add'}
          />
          <button type="button" className="btn btn--ghost" onClick={addAnother} disabled={!another.trim() || isTnea(another)}>
            <span className="btn__inner">Add</span>
          </button>
        </div>
      ) : (
        <button type="button" className="link-btn exam-attempts__more" onClick={() => setShowAnother(true)}>
          + Another exam
        </button>
      )}

      {attempts.length > 0 && (
        <ul className="exam-attempts__list">
          {attempts.map((t) => (
            <li key={t.key} className="attempt-row">
              <span className="attempt-row__exam">{t.exam}</span>
              <span className="attempt-row__q">
                <span className="attempt-row__label">Got an offer?</span>
                <ChipRow<'yes' | 'no'>
                  label={`Did ${t.exam} give you an offer?`}
                  options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                  value={t.admit} onChange={(admit) => patch(t.key, { admit })}
                />
              </span>
              <input
                className="attempt-row__rank" type="text" inputMode="numeric" placeholder="rank (optional)"
                aria-label={`${t.exam} rank, optional`}
                value={t.rank} onChange={(e) => patch(t.key, { rank: e.target.value.replace(/[^\d]/g, '') })}
              />
              {/* An offer is worth almost nothing without the college it was
                  from, and the college used to have to be typed again in a
                  separate block that then asked how it was offered - a
                  question already answered by which exam this is. So it is
                  asked here, beside the rank, and the route is never asked
                  twice (Round 11). */}
              {t.admit === 'yes' && degreeOptions && (
                <div className="attempt-row__offer">
                  <EntitySearchField
                    kind="college" label="Offered by" hint="short names work — “PSG Tech”, “VIT Chennai”"
                    value={t.offer?.college ?? ''}
                    onChange={(college) => patchOffer(t, { college, pick: null })}
                    onSelect={(hit) => patchOffer(t, hit ? { college: hit.name, pick: toPick(hit) } : { pick: null })}
                  />
                  <div className="two-col">
                    <SelectBox
                      label="Degree" value={t.offer?.degree ?? ''} placeholder="Select…"
                      options={degreeOptions.filter((o) => o !== 'Other')}
                      onChange={(degree) => patchOffer(t, { degree })}
                    />
                    <OptionSearchField
                      label="Branch" options={branchOptions ?? []} aliases={branchAliases ?? {}}
                      extra={contextualBranchAliases(t.offer?.degree ?? '')}
                      value={t.offer?.branch ?? ''}
                      onChange={(branch) => patchOffer(t, { branch })}
                    />
                  </div>
                </div>
              )}
              {tookGap && years.length > 0 && (
                <span className="attempt-row__q">
                  <span className="attempt-row__label">Year</span>
                  <ChipRow<string>
                    label={`Which year did you write ${t.exam}?`}
                    options={years.map((y) => ({ value: y, label: y }))}
                    value={t.year || years[0]} onChange={(year) => patch(t.key, { year })}
                  />
                </span>
              )}
              {!examAreas(t.exam).length && !examOptions.some((o) => normText(o) === normText(t.exam)) && (
                <span className="attempt-row__note">new to our list — the school will check the spelling</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
