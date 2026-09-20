import { ImageResponse } from 'next/og';
import { SCHOOL_GROUP_NAME } from '../types';
import { siteHost } from '../site';
import { crestDataUrl, manropeMedium, soraBold } from './assets';

/**
 * The picture a shared link shows.
 *
 * Satori, which draws this, is not a browser: no CSS grid, every element with
 * more than one child needs an explicit display:flex, and it renders no emoji
 * at all - which matters on a site that uses them everywhere else.
 *
 * Two rules the card lives by. It must never throw: a card route that errors
 * produces no preview, which is worse than a plain one, so the photo is
 * optional and every failure falls back. And it must stay well under ~600KB,
 * because WhatsApp silently drops previews above roughly that and
 * ImageResponse only emits PNG - hence a flat background rather than anything
 * photographic behind the text.
 */

export const OG_SIZE = { width: 1200, height: 630 };

const INK = '#0b0a0c';
const PAPER = '#f4f1ea';
const GOLD = '#d4af37';

/**
 * The person's own photo, inlined.
 *
 * Satori can be handed a remote URL, but a fetch it does itself is the most
 * common way one of these cards fails - and a failure here means no preview at
 * all. Fetching the bytes means the failure is ours to catch.
 */
async function inlinePhoto(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 3_000_000) return null;
    return `data:${type};base64,${Buffer.from(buf).toString('base64')}`;
  } catch {
    return null;
  }
}

export type CardInput = {
  name: string;
  classOf?: number | null;
  college?: string | null;
  route?: string | null;
  photoUrl?: string | null;
  initials: string;
  tint: string;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function renderProfileCard(input: CardInput) {
  const photo = await inlinePhoto(input.photoUrl);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: INK, color: PAPER, padding: 64, position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <img src={crestDataUrl} width={68} height={68} alt="" />
          <div style={{ display: 'flex', fontFamily: 'Sora', fontSize: 30, letterSpacing: -0.4 }}>
            {SCHOOL_GROUP_NAME}
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 48, marginTop: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: 700 }}>
            <div style={{ display: 'flex', fontFamily: 'Sora', fontSize: 64, lineHeight: 1.1 }}>
              {clip(input.name, 38)}
            </div>
            <div style={{ display: 'flex', fontFamily: 'Manrope', fontSize: 30, marginTop: 14, opacity: 0.82 }}>
              {[input.classOf ? `Class of ${input.classOf}` : null, 'Alumni of our school']
                .filter(Boolean).join('  ·  ')}
            </div>
            {input.college && (
              <div style={{ display: 'flex', fontFamily: 'Sora', fontSize: 34, marginTop: 22, color: GOLD }}>
                {clip(input.college, 40)}
              </div>
            )}
            {input.route && (
              <div
                style={{
                  display: 'flex', marginTop: 22, alignSelf: 'flex-start',
                  padding: '10px 22px', borderRadius: 999,
                  border: `2px solid ${GOLD}`, color: GOLD,
                  fontFamily: 'Manrope', fontSize: 26,
                }}
              >
                via {clip(input.route, 30)}
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 300, height: 300, borderRadius: 300,
              border: `6px solid ${GOLD}`, overflow: 'hidden',
              background: photo ? INK : input.tint,
              fontFamily: 'Sora', fontSize: 92, color: INK,
            }}
          >
            {photo
              ? <img src={photo} width={300} height={300} style={{ objectFit: 'cover' }} alt="" />
              : input.initials}
          </div>
        </div>

        <div style={{ display: 'flex', fontFamily: 'Manrope', fontSize: 24, opacity: 0.6 }}>
          {siteHost()}
        </div>
        <div
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 10,
            display: 'flex', background: GOLD,
          }}
        />
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: 'Sora', data: soraBold(), weight: 700, style: 'normal' },
        { name: 'Manrope', data: manropeMedium(), weight: 500, style: 'normal' },
      ],
    },
  );
}
