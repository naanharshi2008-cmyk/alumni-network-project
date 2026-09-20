'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  loadDataArea, loadValueBench, type AliasRow, type CollegeInfoRow,
} from '../adminData';
import { useAdminShell } from '../shell';
import ValueMergeTab, { type OptionRow } from '../ValueMerge';
import { CollegeInfoCard, FindInstitute } from '../institutes';
import { EmptyCard, TabButton, TabIntro } from '../ui';

/**
 * The cleanup bench.
 *
 * Nobody is waiting on any of this the way they wait on an approval - the
 * things that are waiting all live in Review now - but it is what keeps the
 * directory coherent: one name per college, one spelling per exam.
 */

type Bench = 'values' | 'institutes';

export default function DataPage() {
  const { refreshCounts } = useAdminShell();
  const [bench, setBench] = useState<Bench>('values');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionNote, setActionNote] = useState('');

  const [approvedOptions, setApprovedOptions] = useState<Record<string, string[]>>({});
  const [optionRows, setOptionRows] = useState<OptionRow[]>([]);
  const [people, setPeople] = useState<{ id: string }[]>([]);
  const [collegesInfo, setCollegesInfo] = useState<CollegeInfoRow[]>([]);
  const [aliases, setAliases] = useState<Record<string, AliasRow[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    // The merge tool counts how many profiles are on each spelling, so it
    // needs everyone's option columns as well as the lists.
    const [values, area] = await Promise.all([loadValueBench(), loadDataArea()]);
    setApprovedOptions(values.approvedOptions);
    setOptionRows(values.optionRows);
    setPeople(values.people);
    setCollegesInfo(area.colleges);
    setAliases(area.aliases);
    if (area.error || values.error) setActionError('Could not load everything: ' + (area.error || values.error));
    setLoading(false);
    refreshCounts();
  }, [refreshCounts]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="subtitle">Loading…</p>;

  return (
    <>
      <div className="chips" style={{ marginBottom: 24 }}>
        <TabButton active={bench === 'values'} onClick={() => setBench('values')}
          label="🏷 Values & spellings" count={Object.keys(approvedOptions).length} />
        <TabButton active={bench === 'institutes'} onClick={() => setBench('institutes')}
          label="🏛 Institutes" count={collegesInfo.length} />
      </div>

      {actionError && <div className="alert alert--error">{actionError}</div>}
      {actionNote && <div className="alert alert--success">{actionNote}</div>}

      {bench === 'values' && (
        <>
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
