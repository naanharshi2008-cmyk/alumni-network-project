/**
 * Claim links: the way into a profile the school started.
 *
 * The token is random and lives only in the link; the database keeps its
 * SHA-256 (claim_tokens.token_hash, migration 19), so a leaked table hands
 * nobody a working link. Server-only - it uses Node's crypto.
 */

import { createHash, randomBytes } from 'crypto';
import { siteUrl } from './mailer';

/** How long a claim link works. The table's default says the same. */
export const CLAIM_DAYS = 14;

export function hashClaimToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

export function newClaimToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: hashClaimToken(token) };
}

export function claimUrl(token: string): string {
  return `${siteUrl()}/claim?c=${encodeURIComponent(token)}`;
}

/** A WhatsApp link for a message, to a number when there is one. */
export function whatsappLink(text: string, code?: string | null, phone?: string | null): string {
  const digits = `${code ?? ''}${phone ?? ''}`.replace(/\D/g, '');
  const to = phone && digits.length >= 10 ? digits : '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
