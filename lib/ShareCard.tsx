'use client';

import { useState } from 'react';

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

export const SHARE_MESSAGE =
  'I’ve added where I went after 12th to the Veveaham Alumni network, so juniors can see the paths ahead. '
  + 'Add yours — it takes about five minutes.';

export default function ShareCard({ slug, firstName, prominent }: {
  /** Their public slug: the link names them even before they are published. */
  slug: string | null;
  firstName: string;
  /** The big version, straight after registering. */
  prominent?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const link = `${origin}/register${slug ? `?from=${encodeURIComponent(slug)}` : ''}`;
  const text = `${SHARE_MESSAGE}\n${link}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

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
