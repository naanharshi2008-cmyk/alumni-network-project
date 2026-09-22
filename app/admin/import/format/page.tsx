'use client';

import React from 'react';
import Link from 'next/link';
import { EXAMS } from '../../../../lib/exams';
import { TEMPLATE, templateCsv, type TemplateColumn } from '../../../../lib/importer';

/**
 * What to put in the sheet - for whoever in the office fills it.
 *
 * Every column the platform holds, what it means, an example, and the values
 * it accepts. The office fills what it knows from the ERP and leaves the rest
 * blank; the student confirms and adds the rest themselves. The school's raw
 * Google Form export also loads, so this is the fuller version of that, not a
 * replacement the office has to retype into.
 */

const GROUP_NOTES: Partial<Record<TemplateColumn['group'], string>> = {
  'Family & home': 'Private. Only the school and the student ever see these — they are never shown on any page.',
  'After Class 12': 'How they got in is one of: Board marks, Board marks (TNEA), Entrance exam, Management seat, Other. TNEA is counselling on board marks, not an exam. Leave it blank if you do not know — the student will say.',
  'Exams written': 'Up to five. Every exam they wrote, including ones that did not lead to a seat. Ranks are optional and only ever shown as a range.',
  'Offers not taken': 'Up to three colleges that offered a seat they did not take. These are recorded as the school’s, so the student cannot remove them.',
};

export default function ImportFormatPage() {
  const groups = [...new Set(TEMPLATE.map((c) => c.group))];

  function download() {
    const blob = new Blob([templateCsv()], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'veveaham-alumni-import-template.csv'; a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="import-format">
      <p className="crumb"><Link href="/admin/import">← Import</Link></p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>What to put in the sheet</h2>
        <p className="subtitle" style={{ fontSize: '0.9rem' }}>
          One row per student. Fill what the office knows — parents and address from the ERP, the exams they
          wrote if you know them — and leave the rest blank. Nothing here is published: each student is invited
          to check it, add the rest and agree before anything appears.
        </p>
        <div className="queue__actions">
          <button type="button" className="btn btn--primary" onClick={download}>
            <span className="btn__inner">Download the template (CSV)</span>
          </button>
        </div>
        <p className="hint" style={{ display: 'block', marginTop: 8 }}>
          To fill it in Google Sheets: open a new sheet, then File → Import → Upload, and choose the file. Share the
          finished sheet with alumni@dpmschools.com (Viewer), and paste its link on the import page.
          The school&apos;s own Google Form export also loads as it is — its columns are matched for you.
        </p>

        {groups.map((g) => (
          <section key={g} className="import-format__group">
            <h3 className="step-subhead">{g}</h3>
            {GROUP_NOTES[g] && <p className="form-note" style={{ marginTop: 0 }}>{GROUP_NOTES[g]}</p>}
            <table className="import-format__table">
              <thead>
                <tr><th>Column</th><th>What it is</th><th>Example</th></tr>
              </thead>
              <tbody>
                {TEMPLATE.filter((c) => c.group === g && !/^(exam|offer)_[2-9]/.test(c.key)).map((c) => (
                  <tr key={c.key}>
                    <td>
                      <strong>{c.header.replace(/ 1\b/, ' 1…5').replace(/^Offer 1…5/, 'Offer 1…3')}</strong>
                      {c.required && <span className="req" aria-hidden> *</span>}
                    </td>
                    <td>
                      {c.about}
                      {c.allowed && <span className="import-format__allowed">One of: {c.allowed.join(' · ')}</span>}
                    </td>
                    <td><code>{c.example}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        <section className="import-format__group">
          <h3 className="step-subhead">Exam names the site knows</h3>
          <p className="form-note" style={{ marginTop: 0 }}>
            Short forms work — JEE for JEE Main, AEEE for AMRITAEEE, IISER for the IAT. A new exam is fine too; the
            school checks the spelling once and it joins the list.
          </p>
          <p className="import-format__exams">{EXAMS.map((e) => e.name).join(' · ')}</p>
        </section>
      </div>
    </div>
  );
}
