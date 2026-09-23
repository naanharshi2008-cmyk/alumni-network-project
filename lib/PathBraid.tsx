import Link from 'next/link';
import type { BraidColumn } from './profilePath';

/**
 * Every way in that was open, side by side.
 *
 * The other exams and the offers not taken used to be an `aside`: a smaller,
 * fainter list tucked inside the step above them, which read as a footnote.
 * But the exams that led nowhere are exactly what a junior is trying to learn
 * from - "attempted is not admitted" is the whole point - so they are drawn as
 * what they are: real threads, the same size and weight as the one taken, in a
 * quieter ink, each stopping where it stopped.
 *
 * A component of its own so the person's page and a scratch page can render
 * the same markup, and so the columns' shape is checkable without a browser.
 */
export default function PathBraid({ columns }: { columns: BraidColumn[] }) {
  if (!columns.length) return null;
  return (
    <div className="braid" role="list" aria-label="How they got in, and what each way offered">
      {columns.map((col) => (
        <div
          key={col.key} role="listitem"
          className={`braid__col braid__col--${col.kind}${col.continues ? ' braid__col--continues' : ''}`}
        >
          <div className="braid__route">{col.label}</div>
          {col.meta ? <div className="braid__meta">{col.meta}</div> : <div />}
          {/* The threads that stop need a line of their own to stop at. The one
              they took does not: the timeline's own rail, running down the left
              of every step, is its thread - and a second stub beside it, with
              the degree a step below rather than in this column, read as a line
              that led nowhere. */}
          {col.continues ? <div /> : <div className="braid__thread" aria-hidden />}
          <div className="braid__outcomes">
            {col.outcomes.map((o) => (
              <div key={o.key} className={`braid__outcome${o.taken ? ' braid__outcome--taken' : ''}`}>
                <span className="braid__where">
                  {o.href ? <Link href={o.href}>{o.text}</Link> : o.text}
                  {o.now && <span className="timeline__now">Now</span>}
                </span>
                {o.meta && <span className="braid__outcome-meta">{o.meta}</span>}
                {/* A column that stops says "not taken" once, at its end. The
                    taken column does not stop, so an offer sitting in it -
                    a second chance at the same door - has to say so itself. */}
                {!o.taken && col.continues && <span className="braid__outcome-meta">not taken</span>}
              </div>
            ))}
          </div>
          {col.continues ? <div /> : <div className="braid__end">{col.ended}</div>}
        </div>
      ))}
    </div>
  );
}
