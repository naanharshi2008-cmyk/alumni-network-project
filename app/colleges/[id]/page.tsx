'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { fetchApprovedAlumni } from '../../../lib/publicData';
import { routePhrase } from '../../../lib/admission';
import { instituteInitials, instituteTint, shortInstituteName } from '../../../lib/showcase';
import { Alumnus, collegeDetailsOf, collegeKeyer } from '../../../lib/types';
import PersonCard from '../../../lib/PersonCard';

type College = {
  id: string; name: string; state: string | null; district: string | null;
  website: string | null; university_name: string | null; management_type: string | null;
  established_year: number | null; banner_url: string | null; logo_url: string | null;
  description: string | null;
};

type Photo = {
  id: string; url: string; caption: string | null;
  shared_by: string | null; shared_by_slug: string | null; shared_by_class: number | null;
};

type MyPhoto = { id: string; url: string; caption: string | null; status: string };

/**
 * One college: what it is, who from here is there, and what it actually looks
 * like through their eyes.
 *
 * The gallery is the point of the page. A banner the school uploaded says the
 * institution exists; a photo a senior took in their own corridor says someone
 * from this school is living there. Every photo waits for the school before it
 * appears, and carries the name of whoever shared it.
 */
/** Enough to fill a screen; the rest is one click away. */
const SENIORS_SHOWN = 12;

export default function CollegePage() {
  const collegeId = String(useParams().id ?? '');
  const [college, setCollege] = useState<College | null>(null);
  const [seniors, setSeniors] = useState<Alumnus[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [mine, setMine] = useState<MyPhoto[]>([]);
  const [canContribute, setCanContribute] = useState(false);
  // 'missing' and 'error' are different answers: one says this college does
  // not exist, the other says we could not find out. They used to be the same
  // message, so a dropped connection told the visitor a real college was not
  // real.
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [seniorsError, setSeniorsError] = useState('');
  const [allSeniors, setAllSeniors] = useState(false);
  const [photosError, setPhotosError] = useState('');

  const load = useCallback(async () => {
    if (!collegeId) { setState('missing'); return; }

    const [{ data: row, error: rowErr }, alumniRes, { data: pics, error: picsErr }] = await Promise.all([
      supabase.from('colleges')
        .select('id, name, state, district, website, university_name, management_type, established_year, banner_url, logo_url, description')
        .eq('id', collegeId).maybeSingle(),
      fetchApprovedAlumni(),
      supabase.from('college_photos_public')
        .select('id, url, caption, shared_by, shared_by_slug, shared_by_class')
        .eq('college_id', collegeId)
        .order('created_at', { ascending: false }),
    ]);

    if (rowErr) { setState('error'); return; }
    if (!row) { setState('missing'); return; }
    setCollege(row as College);

    // Count the seniors the way /colleges counts them on the tile that linked
    // here: collegeKeyer folds a typed spelling into the linked college, and
    // strict equality did not, so a tile could say 3 and this page say 2.
    const all = (alumniRes.data ?? []) as Alumnus[];
    const keyOf = collegeKeyer(all);
    setSeniorsError(alumniRes.error);
    setSeniors(all.filter((a) => keyOf(a) === `id:${collegeId}`));
    // A gallery that failed to load and a gallery with nothing in it looked
    // identical - both said "No photos yet", which invites nobody to fix it.
    setPhotosError(picsErr?.message ?? '');
    setPhotos((pics ?? []) as Photo[]);
    setState('ready');

    // Anything of your own that is still waiting, plus whether you may add more.
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return;
    const { data: me } = await supabase
      .from('alumni').select('id, college_id, approval_status')
      .eq('user_id', session.session.user.id).maybeSingle();
    setCanContribute(!!me && me.approval_status === 'approved' && me.college_id === collegeId);
    if (me) {
      const { data: ownPics } = await supabase
        .from('college_photos').select('id, url, caption, status')
        .eq('college_id', collegeId).eq('alumni_id', me.id).eq('status', 'pending');
      setMine((ownPics ?? []) as MyPhoto[]);
    }
  }, [collegeId]);

  useEffect(() => { void load(); }, [load]);

  // The aliases come from the seniors' own rows - the view carries them, and
  // the colleges table query does not. Passing [] meant shortInstituteName
  // could never shorten anything, which is the whole reason it exists.
  const label = useMemo(() => {
    if (!college) return '';
    const aliases = seniors.map((a) => collegeDetailsOf(a)?.aliases ?? []).find((x) => x.length) ?? [];
    return shortInstituteName(college.name, aliases);
  }, [college, seniors]);
  const shownSeniors = allSeniors ? seniors : seniors.slice(0, SENIORS_SHOWN);
  const place = college ? [college.district, college.state].filter(Boolean).join(', ') : '';
  const routes = useMemo(
    () => Array.from(new Set(seniors.map((s) => routePhrase(s)).filter(Boolean) as string[])),
    [seniors],
  );

  if (state === 'loading') {
    return (
      <div className="container container--wide">
        <h1 className="sr-only">Loading college</h1>
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="container container--wide">
        <div className="empty">
          <span className="empty__emoji">😕</span>
          <h1>We couldn&apos;t load that college</h1>
          <p>Something went wrong at our end, not yours. Try again in a moment.</p>
          <p><Link href="/colleges" className="link-btn">Back to all colleges</Link></p>
        </div>
      </div>
    );
  }
  if (state === 'missing' || !college) {
    return (
      <div className="container container--wide">
        <div className="empty">
          <span className="empty__emoji">🏛️</span>
          <h1>We don&apos;t have that college</h1>
          <p><Link href="/colleges" className="link-btn">Back to all colleges</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div className="container container--wide">
      <p className="crumb"><Link href="/colleges">← All colleges</Link></p>

      <header className="cpage__head fade-up">
        <div
          className="cpage__banner"
          style={{ '--tint': instituteTint(`id:${collegeId}`) } as React.CSSProperties}
        >
          {college.banner_url
            ? <img src={college.banner_url} alt="" />
            : <span className="cpage__banner-fallback" aria-hidden>{instituteInitials(label)}</span>}
          {college.logo_url && (
            <span className="cpage__logo"><img src={college.logo_url} alt="" loading="lazy" /></span>
          )}
        </div>

        <div className="cpage__title">
          <h1>{college.name}</h1>
          <p className="subtitle">
            {[place, college.university_name !== college.name ? college.university_name : null]
              .filter(Boolean).join(' · ')}
          </p>
          {routes.length > 0 && (
            <div className="xcollege__chips" style={{ marginTop: 10 }}>
              {routes.map((r) => <span key={r} className="badge badge--sm">via {r}</span>)}
            </div>
          )}
          {/* Founded-in and who runs it are worth knowing and not worth a
              badge each, level with how many of our seniors are here. */}
          {(college.management_type || college.established_year) && (
            <p className="cpage__trivia">
              {[college.management_type, college.established_year && `established ${college.established_year}`]
                .filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="cpage__actions">
            {seniors.length > 0 && (
              <Link href={`/directory?lens=college&q=${encodeURIComponent(label)}`} className="btn btn--ghost">
                <span className="btn__inner">See them in the directory →</span>
              </Link>
            )}
            {college.website && (
              <a
                href={college.website.startsWith('http') ? college.website : `https://${college.website}`}
                target="_blank" rel="noopener noreferrer" className="btn btn--ghost"
              >
                <span className="btn__inner">Their website ↗</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* The people first. This page exists to answer "who from my school is
          here?", and they used to be 0.86rem chips below the college's own
          facts - the smallest thing on the page. */}
      <section className="cpage__section">
        <h2>{seniors.length > 0 ? `${seniors.length} Veveaham ${seniors.length === 1 ? 'senior' : 'seniors'} here` : 'Seniors here'}</h2>
        {seniorsError ? (
          <p className="lens-note">We couldn&apos;t load the seniors just now — the rest of this page is fine.</p>
        ) : seniors.length === 0 ? (
          <p className="lens-note">No approved profiles at this college yet.</p>
        ) : (
          <>
            <div className="cpage__seniors">
              {shownSeniors.map((a) => <PersonCard key={a.id} a={a} size="md" />)}
            </div>
            {seniors.length > SENIORS_SHOWN && !allSeniors && (
              <button type="button" className="btn btn--ghost" style={{ marginTop: 14 }} onClick={() => setAllSeniors(true)}>
                <span className="btn__inner">Show all {seniors.length} →</span>
              </button>
            )}
          </>
        )}
      </section>

      {college.description && (
        <section className="cpage__section">
          <h2>About {label}</h2>
          <p className="college-desc cpage__about">{college.description}</p>
        </section>
      )}

      <section className="cpage__section">
        <h2>Photos from our seniors</h2>
        {photosError ? (
          <p className="lens-note">We couldn&apos;t load the photos just now — the rest of this page is fine.</p>
        ) : photos.length === 0 ? (
          <p className="lens-note">
            No photos yet.{canContribute ? ' Yours would be the first.' : ' Seniors studying here can add the first one.'}
          </p>
        ) : (
          <div className="gallery-grid">
            {photos.map((p) => (
              <figure key={p.id} className="shot">
                <img src={p.url} alt={p.caption ?? ''} loading="lazy" decoding="async" />
                <figcaption>
                  {p.caption && <span className="shot__caption">{p.caption}</span>}
                  {p.shared_by && (
                    <span className="shot__credit">
                      Shared by{' '}
                      {p.shared_by_slug
                        ? <Link href={`/alumni/${encodeURIComponent(p.shared_by_slug)}`}>{p.shared_by}</Link>
                        : p.shared_by}
                      {p.shared_by_class ? ` ’${String(p.shared_by_class).slice(-2)}` : ''}
                    </span>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {mine.length > 0 && (
          <div className="waiting">
            <p className="waiting__head">Waiting for the school ({mine.length})</p>
            <div className="gallery-grid">
              {mine.map((p) => (
                <figure key={p.id} className="shot shot--pending">
                  <img src={p.url} alt={p.caption ?? ''} loading="lazy" />
                  <figcaption>
                    <span className="shot__caption">{p.caption || 'No caption'}</span>
                    <WithdrawPhoto id={p.id} onDone={() => void load()} />
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        {canContribute && <AddPhoto collegeId={collegeId} onAdded={() => void load()} />}
      </section>
    </div>
  );
}

function WithdrawPhoto({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button" className="link-btn" disabled={busy}
      onClick={async () => {
        setBusy(true);
        const { data } = await supabase.auth.getSession();
        await fetch('/api/college-photo', {
          method: 'DELETE',
          headers: {
            'content-type': 'application/json',
            ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
          },
          body: JSON.stringify({ id }),
        }).catch(() => undefined);
        setBusy(false);
        onDone();
      }}
    >
      {busy ? 'Withdrawing…' : 'Withdraw'}
    </button>
  );
}

/** Upload, shrunk in the browser first so a phone photo is not a 9MB upload. */
function AddPhoto({ collegeId, onAdded }: { collegeId: string; onAdded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  async function shrink(file: File): Promise<Blob> {
    if (file.size < 1.5 * 1024 * 1024) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / bitmap.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
      return blob ?? file;
    } catch {
      return file; // downscaling is an optimisation, never a gate
    }
  }

  async function send() {
    const file = fileRef.current?.files?.[0];
    setError(''); setNote('');
    if (!file) { setError('Pick a photo first.'); return; }
    if (!file.type.startsWith('image/')) { setError('That file is not an image.'); return; }
    setBusy(true);
    try {
      const body = new FormData();
      const shrunk = await shrink(file);
      body.append('file', new File([shrunk], file.name.replace(/\.[^.]+$/, '.jpg'), { type: shrunk.type || file.type }));
      body.append('college_id', collegeId);
      body.append('caption', caption);
      const { data } = await supabase.auth.getSession();
      const res = await fetch('/api/college-photo', {
        method: 'POST',
        headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : undefined,
        body,
      });
      const out = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) { setError(out.error ?? 'That did not work.'); return; }
      setNote(out.message ?? 'Sent to the school.');
      setCaption('');
      if (fileRef.current) fileRef.current.value = '';
      onAdded();
    } catch {
      setError('We could not reach the server. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-photo">
      <p className="add-photo__head">Add a photo of your campus</p>
      <p className="hint" style={{ display: 'block', margin: '0 0 12px' }}>
        Somewhere a junior would want to see. The school checks it before it appears, and your name goes with it.
      </p>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" />
      <input
        type="text" value={caption} maxLength={160} placeholder="A line about it (optional)"
        onChange={(e) => setCaption(e.target.value)} style={{ marginTop: 10 }}
      />
      <button type="button" className="btn btn--primary" style={{ marginTop: 12 }} disabled={busy} onClick={send}>
        <span className="btn__inner">{busy ? 'Sending…' : 'Send to the school'}</span>
      </button>
      {note && <p className="add-photo__ok">{note}</p>}
      {error && <p className="field__error field__error--static">{error}</p>}
    </div>
  );
}
