import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomInt } from 'crypto';

/**
 * Fixed-window counter in public.auth_throttle (service role only).
 * Returns true when this hit is within the limit. Fails open on a database
 * error: a broken throttle must not lock everyone out of password resets.
 */
export async function allowHit(admin: SupabaseClient, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const now = Date.now();
    const { data } = await admin.from('auth_throttle').select('window_start, hits').eq('key', key).maybeSingle();
    const expired = !data || now - new Date(data.window_start).getTime() > windowSeconds * 1000;
    const hits = expired ? 1 : data!.hits + 1;
    await admin.from('auth_throttle').upsert({
      key,
      window_start: expired ? new Date(now).toISOString() : data!.window_start,
      hits,
    });
    return hits <= limit;
  } catch (err) {
    console.error('throttle: failing open', err);
    return true;
  }
}

/** Keys are hashed so the table never stores an email or phone number. */
export function throttleKey(scope: string, value: string): string {
  return `${scope}:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

export function clientIp(request: Request): string {
  return (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}

/**
 * A temporary password an admin can read out or send on WhatsApp: no
 * look-alike characters (0/O, 1/l/I), grouped for reading, ~62 bits.
 */
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const group = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}
