'use client';

import { useState } from 'react';

/**
 * The one interactive thing on an otherwise static page.
 *
 * window.location.origin rather than a configured host: whatever address the
 * visitor is reading this at is the address they should be sharing, which
 * also means it survives the move to the school's own domain untouched.
 */
export default function ShareButton({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    const title = `${name} — Veveaham Alumni`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Cancelled, or not permitted. Fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* Some browsers refuse without a gesture they recognise; the URL bar works. */
    }
  }

  return (
    <button type="button" className="btn btn--ghost" onClick={share}>
      <span className="btn__inner">{copied ? '✓ Link copied' : 'Share this profile'}</span>
    </button>
  );
}
