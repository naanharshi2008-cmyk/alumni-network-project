/**
 * Contact normalisers, mirroring public.email_key() and public.phone_key() in
 * migrations/08_accounts_email_phone.sql exactly. Keep the two in step: the
 * database enforces uniqueness on these keys, and the forms and routes use
 * these to predict and explain it.
 */

export function emailKey(value: string | null | undefined): string | null {
  const key = (value ?? '').trim().toLowerCase();
  return key || null;
}

/** "+91", "098765 43210" -> "919876543210". A number of only zeros is null. */
export function phoneKey(code: string | null | undefined, number: string | null | undefined): string | null {
  let digits = (number ?? '').replace(/\D/g, '');
  if (!digits) return null;
  digits = digits.replace(/^0+/, '');
  if (!digits) return null;
  let cc = (code ?? '').replace(/\D/g, '');
  if (!cc) cc = '91';
  if (digits.length > 10 && digits.startsWith(cc)) return digits;
  return cc + digits;
}

/**
 * The keys a phone number typed on its own (no separate country code) could
 * be stored under: a bare number is read as Indian unless it already carries
 * a code. Mirrors login_handle().
 */
export function phoneLoginCandidates(input: string): string[] {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 7) return [];
  return [...new Set([phoneKey('+91', digits), phoneKey('', digits), digits].filter(Boolean) as string[])];
}

/**
 * Why a typed number cannot be real, or '' if it could be.
 *
 * The registration check was `value.length < 7` on a string that counts spaces,
 * so "12 34 5" - five digits - was accepted. A number is how half the people
 * here sign in, and the only way the school can reach them, so it is worth
 * being exact: Indian mobiles are ten digits starting 6-9, everything else
 * gets the E.164 range.
 */
export function phoneProblem(code: string | null | undefined, number: string | null | undefined): string {
  const digits = (number ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return 'We need a phone number to reach you.';
  const cc = (code ?? '').replace(/\D/g, '') || '91';
  if (cc === '91') {
    if (digits.length !== 10) {
      return digits.length < 10 ? 'An Indian mobile number has 10 digits.' : 'That is more than 10 digits.';
    }
    if (!/^[6-9]/.test(digits)) return 'Indian mobile numbers start with 6, 7, 8 or 9.';
    return '';
  }
  if (digits.length < 7) return 'That number looks too short.';
  if (digits.length > 15) return 'That number looks too long.';
  return '';
}

export function looksLikePhone(value: string): boolean {
  return /^[+\d\s()-]+$/.test(value.trim()) && value.replace(/\D/g, '').length >= 7;
}
