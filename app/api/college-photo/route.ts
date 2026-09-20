import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAdminClient, requireUser, safeErrorMessage } from '../../../lib/supabaseAdmin';

/**
 * A photo of a campus, offered by someone who is actually there.
 *
 * The upload itself runs with the service role, exactly as college banners do:
 * the bucket has no storage policies, so an image can only arrive through a
 * route that has first checked who is asking. What this route enforces before
 * touching storage is the thing row-level security cannot see — that the file
 * is an image of the right type and size.
 *
 * Who may post is then enforced twice: here, by looking up the caller's own
 * approved profile, and again by the INSERT policy on college_photos, which
 * requires the row to be theirs, pending, and for the college they are linked
 * to. The row is written with the caller's own token so that policy applies.
 *
 * Nothing is shown to anyone until the school approves it.
 */

export const runtime = 'nodejs';

const BUCKET = 'college-photos';
const MAX_BYTES = 4 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  // No SVG: it can carry scripts and would be served from our own origin.
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PENDING = 5;

/**
 * A client that acts as the person making the request, so row-level security
 * still applies. The service role is used for the file and for lookups, but
 * the row itself is written this way: the INSERT policy on college_photos is
 * then the final word on who may add a photo of which college, rather than
 * this file's own checks being the only thing standing there.
 */
function callerClient(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const authorization = request.headers.get('authorization') ?? '';
  if (!url || !anon || !authorization) return null;
  return createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: 'Photos are not set up on the server yet.' }, { status: 503 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Malformed upload.' }, { status: 400 });
  }

  const collegeId = String(form.get('college_id') ?? '');
  if (!UUID_RE.test(collegeId)) {
    return NextResponse.json({ error: 'Missing or invalid college.' }, { status: 400 });
  }
  const caption = String(form.get('caption') ?? '').trim().slice(0, 160);

  const { data: person } = await admin
    .from('alumni')
    .select('id, college_id, approval_status')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (!person || person.approval_status !== 'approved') {
    return NextResponse.json(
      { error: 'Only approved alumni can add photos. Yours is still with the school.' },
      { status: 403 },
    );
  }
  if (person.college_id !== collegeId) {
    return NextResponse.json(
      { error: 'You can add photos of the college on your own profile.' },
      { status: 403 },
    );
  }

  // A queue the school can actually get through.
  const { count } = await admin
    .from('college_photos')
    .select('id', { count: 'exact', head: true })
    .eq('alumni_id', person.id)
    .eq('status', 'pending');
  if ((count ?? 0) >= MAX_PENDING) {
    return NextResponse.json(
      { error: `You already have ${count} photos waiting for the school. Give them a moment.` },
      { status: 429 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Please choose a photo.' }, { status: 400 });
  }
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) return NextResponse.json({ error: 'Photos must be JPG, PNG or WEBP.' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That photo is over 4MB — please use a smaller one.' }, { status: 413 });
  }

  const path = `${collegeId}/${person.id}-${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    cacheControl: '31536000',
  });
  if (upErr) {
    return NextResponse.json({ error: `Upload failed: ${safeErrorMessage(upErr)}` }, { status: 500 });
  }
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);

  const asCaller = callerClient(request);
  if (!asCaller) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const { data: row, error: insErr } = await asCaller
    .from('college_photos')
    .insert({
      college_id: collegeId,
      alumni_id: person.id,
      url: pub.publicUrl,
      storage_path: path,
      caption: caption || null,
    })
    .select('id')
    .single();

  if (insErr) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
    return NextResponse.json({ error: `Could not save the photo: ${safeErrorMessage(insErr)}` }, { status: 500 });
  }

  return NextResponse.json({
    id: row.id,
    pending: true,
    message: 'Thank you — the school will take a look before it appears.',
  });
}

/**
 * Withdraw a photo. An alumnus may remove their own while it is still waiting;
 * an admin may remove any. The file goes with the row.
 */
export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });

  let photoId = '';
  try {
    photoId = String(((await request.json()) as { id?: string }).id ?? '');
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }
  if (!UUID_RE.test(photoId)) return NextResponse.json({ error: 'Which photo?' }, { status: 400 });

  const isAdmin = (auth.user.email ?? '').endsWith('@veveaham-admin.local');
  const { data: photo } = await admin
    .from('college_photos')
    .select('id, storage_path, status, alumni_id')
    .eq('id', photoId)
    .maybeSingle();
  if (!photo) return NextResponse.json({ error: 'That photo is already gone.' }, { status: 404 });

  if (!isAdmin) {
    const { data: person } = await admin.from('alumni').select('id').eq('user_id', auth.user.id).maybeSingle();
    if (!person || person.id !== photo.alumni_id || photo.status !== 'pending') {
      return NextResponse.json({ error: 'You can only withdraw your own photo before the school reviews it.' }, { status: 403 });
    }
  }

  // The row goes first, and as the caller, so the DELETE policy decides. Only
  // once it is gone do we remove the file it pointed at.
  const asCaller = callerClient(request);
  if (!asCaller) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const { data: deleted, error: delErr } = await asCaller
    .from('college_photos').delete().eq('id', photoId).select('id');
  if (delErr) return NextResponse.json({ error: `Could not remove it: ${safeErrorMessage(delErr)}` }, { status: 500 });
  if (!deleted?.length) {
    return NextResponse.json({ error: 'You can only withdraw your own photo before the school reviews it.' }, { status: 403 });
  }

  const warnings: string[] = [];
  if (photo.storage_path) {
    const { error: rmErr } = await admin.storage.from(BUCKET).remove([photo.storage_path]);
    if (rmErr) warnings.push(`The file could not be removed (${safeErrorMessage(rmErr)}).`);
  }

  return NextResponse.json({ removed: true, warnings });
}
