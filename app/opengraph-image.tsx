import { ImageResponse } from 'next/og';
import { SCHOOL_GROUP_NAME } from '../lib/types';
import { siteHost } from '../lib/site';
import { OG_SIZE } from '../lib/og/card';
import { crestDataUrl, manropeMedium, soraBold } from '../lib/og/assets';

/**
 * The card for every page that is not a person, so no link from this site ever
 * shares as a bare URL.
 */
export const alt = 'Veveaham Alumni — where our seniors went, and how they got there';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          justifyContent: 'center', background: '#0b0a0c', color: '#f4f1ea', padding: 80,
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <img src={crestDataUrl} width={84} height={84} alt="" />
          <div style={{ display: 'flex', fontFamily: 'Sora', fontSize: 34 }}>{SCHOOL_GROUP_NAME}</div>
        </div>
        <div style={{ display: 'flex', fontFamily: 'Sora', fontSize: 68, lineHeight: 1.12, marginTop: 34 }}>
          Where our seniors are,
        </div>
        <div style={{ display: 'flex', fontFamily: 'Sora', fontSize: 68, lineHeight: 1.12, color: '#d4af37' }}>
          and how they got there.
        </div>
        <div style={{ display: 'flex', fontFamily: 'Manrope', fontSize: 30, marginTop: 26, opacity: 0.8 }}>
          The colleges and courses our seniors went on to, in their own words.
        </div>
        <div style={{ display: 'flex', fontFamily: 'Manrope', fontSize: 24, marginTop: 34, opacity: 0.6 }}>
          {siteHost()}
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 10, display: 'flex', background: '#d4af37' }} />
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
