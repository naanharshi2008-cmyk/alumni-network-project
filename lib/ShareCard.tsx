'use client';

import { useEffect, useState } from 'react';

/**
 * "Invite your batchmates" - the end of registration, and a smaller copy on
 * the profile afterwards.
 *
 * The school's own form reached one student in five. The strongest lever the
 * site has is the person who has just finished: they know who else is
 * missing, and a message from a friend is read where one from the school is
 * not. So the card offers the three ways people actually share - WhatsApp,
 * the phone's own share sheet, and a link to copy - with a message already
 * written, and a link that names them, so the friend is greeted with "Priya
 * invited you" (app/register, invite_card in migration 19).
 */

/**
 * Round 11: the message used to be about juniors only. The network is for
 * everyone who left the school - a batchmate is as good a reason to join as a
 * junior - so it names the network and what is in it, and leaves the reason to
 * the reader. The blank line survives into WhatsApp and, via `pre-line`, into
 * the card's own preview.
 */
export const SHARE_MESSAGE =
  'I’ve just added myself to the Veveaham Alumni Network — where everyone from our batches is, '
  + 'what they studied, where they ended up.\n\nAdd yours so we’re all in one place. About five minutes.';

export default function ShareCard({ slug, firstName, prominent }: {
  /** Their public slug: the link names them even before they are published. */
  slug: string | null;
  firstName: string;
  /** The big version, straight after registering. */
  prominent?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // Read after mounting, not during the render. `window.location.origin` is ''
  // on the server and the real host in the browser, so reading it inline made
  // the two renders disagree and React threw away the whole tree as a
  // hydration mismatch - every time this card was drawn.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const link = `${origin}/register${slug ? `?from=${encodeURIComponent(slug)}` : ''}`;
  const text = `${SHARE_MESSAGE}\n${link}`;
  // navigator.share exists only in the browser, and only on some of them.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === 'function'), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the link is on screen to copy by hand */ }
  }

  return (
    <div className={`share-card${prominent ? ' share-card--big' : ''}`}>
      {prominent ? (
        <>
          <h2 className="share-card__title">You&apos;re in, {firstName} 🎉</h2>
          <p>
            The school reviews your profile before it appears. While you wait: who from your batch is missing?
            Send them this — it says you invited them.
          </p>
        </>
      ) : (
        <p className="share-card__lead"><strong>Invite your batchmates.</strong> A message from you is the one they will open.</p>
      )}
      <blockquote className="share-card__message">{SHARE_MESSAGE}</blockquote>
      <div className="share-card__actions">
        <a className="btn btn--primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
          <span className="btn__inner">WhatsApp</span>
        </a>
        {canShare && (
          <button type="button" className="btn btn--ghost" onClick={() => { void navigator.share({ text: SHARE_MESSAGE, url: link }).catch(() => undefined); }}>
            <span className="btn__inner">Share…</span>
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={() => void copy()}>
          <span className="btn__inner">{copied ? '✓ Copied' : 'Copy message'}</span>
        </button>
      </div>
      <p className="share-card__link"><code>{link.replace(/^https?:\/\//, '')}</code></p>
    </div>
  );
}
