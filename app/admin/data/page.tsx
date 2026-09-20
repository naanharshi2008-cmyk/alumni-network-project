'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  loadDataArea, loadReview, type AliasRow, type AlumniRow, type CollegeInfoRow,
  type PendingOption, type TypedNameGroup,
} from '../adminData';
import { useAdminShell } from '../shell';
import ValueMergeTab, { type OptionRow } from '../ValueMerge';
import { CollegeInfoCard, FindInstitute } from '../institutes';
import { PendingOptionsTab } from '../options';
import { UnmatchedEntityRow } from '../unmatched';
import { EmptyCard, TabButton, TabIntro } from '../ui';

/**
 * The cleanup bench.
 *
 * Nobody is waiting on any of this the way they wait on an approval, but it is
 * what keeps the directory coherent: one name per college, one spelling per
 * exam, and every typed name eventually attached to a real institute.
 */

type Bench = 'values' | 'colleges' | 'companies' | 'institutes';

export default function DataPage() {
  const { refreshCounts } = useAdminShell();
  const [bench, setBench] = useState<Bench>('values');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionNote, setActionNote] = useState('');

  const [pendingOptions, setPendingOptions] = useState<PendingOption[]>([]);
  const [approvedOptions, setApprovedOptions] = useState<Record<string, string[]>>({});
  const [optionRows, setOptionRows] = useState<OptionRow[]>([]);
  const [people, setPeople] = useState<AlumniRow[]>([]);
  const [unmatchedColleges, setUnmatchedColleges] = useState<TypedNameGroup[]>([]);
  const [unmatchedCompanies, setUnmatchedCompanies] = useState<TypedNameGroup[]>([]);
  const [collegesInfo, setCollegesInfo] = useState<CollegeInfoRow[]>([]);
  const [aliases, setAliases] = useState<Record<string, AliasRow[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    // The merge tool counts how many profiles use each value, so it needs the
    // people as well as the lists.
    const [review, area] = await Promise.all([loadReview(), loadDataArea()]);
    setPendingOptions(review.options);
    setApprovedOptions(review.approvedOptions);
    setOptionRows(review.optionRows);
    setPeople([...review.pending, ...review.pendingEdits]);
    setUnmatchedColleges(review.unmatchedColleges);
    setUnmatchedCompanies(review.unmatchedCompanies);
    setCollegesInfo(area.colleges);
    setAliases(area.aliases);
    if (area.error) setActionError('Could not load the colleges: ' + area.error);
    setLoading(false);
    refreshCounts();
  }, [refreshCounts]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="subtitle">Loading…</p>;

  return (
    <>
      <div className="chips" style={{ marginBottom: 24 }}>
        <TabButton active={bench === 'values'} onClick={() => setBench('values')}
          label="🏷 Values & options" count={pendingOptions.length} />
        <TabButton active={bench === 'colleges'} onClick={() => setBench('colleges')}
          label="🏫 Unmatched Colleges" count={unmatchedColleges.length} />
        <TabButton active={bench === 'companies'} onClick={() => setBench('companies')}
          label="🏢 Unmatched Companies" count={unmatchedCompanies.length} />
        <TabButton active={bench === 'institutes'} onClick={() => setBench('institutes')}
          label="🏛 Institutes" count={collegesInfo.length} />
      </div>

      {actionError && <div className="alert alert--error">{actionError}</div>}
      {actionNote && <div className="alert alert--success">{actionNote}</div>}

      {bench === 'values' && (
        <>
          <PendingOptionsTab
            pendingOptions={pendingOptions}
            approvedOptions={approvedOptions}
            onResolved={(id) => setPendingOptions((prev) => prev.filter((o) => o.id !== id))}
            onApprovedValue={(category, value) =>
              setApprovedOptions((prev) => ({ ...prev, [category]: [...(prev[category] ?? []), value] }))
            }
            setError={setActionError}
          />

          <TabIntro title="One name per thing">
            The same exam or degree often arrives spelt three different ways, and the
            directory then offers all three as if they were different things. Tick the
            spellings that mean the same thing, type the name the public should see, and
            everyone moves onto it — including edits still waiting for review. Each old
            spelling is remembered, so the same typing next year maps itself.
          </TabIntro>
          <ValueMergeTab
            people={people}
            approvedOptions={approvedOptions}
            optionRows={optionRows}
            onDone={load}
            setError={setActionError}
            setNote={setActionNote}
          />
        </>
      )}

      {bench === 'colleges' && (
        <div className="stagger">
          <TabIntro title="Colleges we didn't recognise">
            These students typed a college name that didn&apos;t match our list — usually
            just a spelling difference. Fix the spelling once here and everyone who typed
            it gets linked to the same college. If the name is already right, save it as-is
            to add it to the list.
          </TabIntro>
          {unmatchedColleges.length === 0 ? (
            <EmptyCard emoji="🏫" text="No unmatched colleges right now — nice and tidy." />
          ) : (
            unmatchedColleges.map((group) => (
              <UnmatchedEntityRow
                key={group.key}
                kind="colleges"
                groupKey={group.key}
                display={group.display}
                alumniIds={group.alumniIds}
                onResolved={(k) => setUnmatchedColleges((prev) => prev.filter((g) => g.key !== k))}
              />
            ))
          )}
        </div>
      )}

      {bench === 'companies' && (
        <div className="stagger">
          <TabIntro title="Employers we didn't recognise">
            Same idea as colleges: someone typed an employer that isn&apos;t on our list yet.
            Correct it once and every student who typed it is linked to the same record.
          </TabIntro>
          {unmatchedCompanies.length === 0 ? (
            <EmptyCard emoji="🏢" text="Every organisation an alumnus typed is already on the list." />
          ) : (
            unmatchedCompanies.map((group) => (
              <UnmatchedEntityRow
                key={group.key}
                kind="organizations"
                groupKey={group.key}
                display={group.display}
                alumniIds={group.alumniIds}
                onResolved={(k) => setUnmatchedCompanies((prev) => prev.filter((g) => g.key !== k))}
              />
            ))
          )}
        </div>
      )}

      {bench === 'institutes' && (
        <div className="stagger">
          <TabIntro title="Institutes">
            Fix how a college or company is named, add the other names people type
            for it (&ldquo;IITM&rdquo;, &ldquo;NIT Trichy&rdquo;), and merge duplicates. Colleges our
            alumni attend also get a banner, a line about them, and a &ldquo;Note from
            Veveaham&rdquo; for each student.
          </TabIntro>
          <FindInstitute onError={setActionError} onNote={setActionNote} onMerged={() => void load()} />
          {collegesInfo.length === 0 ? (
            <EmptyCard emoji="🖼" text="No matched colleges yet — link some in the Unmatched Colleges tab first." />
          ) : (
            collegesInfo.map((c) => (
              <CollegeInfoCard
                key={c.id}
                college={c}
                initialAliases={aliases[c.id]}
                onChanged={(patch) =>
                  setCollegesInfo((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))
                }
                onNoteSaved={(studentId, note) =>
                  setCollegesInfo((prev) => prev.map((x) =>
                    x.id === c.id
                      ? { ...x, students: x.students.map((st) => (st.id === studentId ? { ...st, school_note: note } : st)) }
                      : x,
                  ))
                }
                onError={setActionError}
                onNote={setActionNote}
                onMerged={() => void load()}
              />
            ))
          )}
        </div>
      )}
    </>
  );
}
