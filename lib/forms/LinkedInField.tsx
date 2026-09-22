'use client';

/**
 * LinkedIn as a username, with a link to check it and one line of nudge.
 *
 * Asked as what students can actually see - the part after linkedin.com/in/
 * - with the prefix drawn in front, so the box explains itself. A pasted link
 * of any shape is read back to the username (lib/linkedin.ts). The link under
 * it opens the profile, so a typo is caught by looking, not by the school.
 */

import { useId, useState } from 'react';
import { linkedinUrl, parseLinkedIn } from '../linkedin';

export default function LinkedInField({ value, onChange }: {
  /** What the person typed or pasted; parseLinkedIn() reads it. */
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const { handle, problem } = parseLinkedIn(value);
  const url = linkedinUrl(handle);

  return (
    <div className="field linkedin-field" data-field="linkedin">
      <label htmlFor={id}>LinkedIn <span className="opt">optional · shown on your page</span></label>
      <div className={`linkedin-field__box${touched && problem ? ' linkedin-field__box--invalid' : ''}`}>
        <span className="linkedin-field__prefix" aria-hidden>linkedin.com/in/</span>
        <input
          id={id} type="text" value={value} autoComplete="off" autoCapitalize="none" spellCheck={false}
          placeholder="your-name"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            setTouched(true);
            // A pasted link settles to the username, so what is saved is what is shown.
            if (handle && handle !== value.trim()) onChange(handle);
          }}
          aria-invalid={touched && !!problem}
          aria-describedby={`${id}-note`}
        />
      </div>
      <p className="hint" id={`${id}-note`} style={{ display: 'block', marginTop: 6 }}>
        {touched && problem ? (
          <span className="field__error field__error--static">{problem}</span>
        ) : url ? (
          <>Check it’s you: <a href={url} target="_blank" rel="noopener noreferrer">{url.replace('https://www.', '')} ↗</a></>
        ) : (
          <>No LinkedIn yet? Five minutes to make one — it is how seniors and juniors find each other later.</>
        )}
      </p>
    </div>
  );
}
