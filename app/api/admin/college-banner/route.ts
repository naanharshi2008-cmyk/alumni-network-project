import { NextResponse } from 'next/server';
import {
  getAdminClient,
  requireAdmin,
  storagePathFromPublicUrl,
  isServiceKeyProblem,
  SERVICE_KEY_MESSAGE,
} from '../../../../lib/supabaseAdmin';

// Uploads, replaces or removes a college's banner image, and saves the
// admin-written college description.
//
// This is the ONLY writer for either field. The college-banners bucket has no
// storage policies at all - deliberately: the service role bypasses storage
// RLS, and a public bucket serves reads without policies, so anon and
// authenticated clients simply cannot write there. Keeping every write on the
// server also means the colleges table's lack of RLS never becomes a problem.
//
// Size: Vercel rejects serverless request bodies over ~4.5MB, so the honest
// limit is 4MB - enforced here, in the admin UI before upload, and by the
// bucket's own file_size_limit as the last line of defence.

export const runtime = 'nodejs';

const BUCKET = 'college-banners';
const MAX_BYTES = 4 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  // SVG deliberately absent: it can carry scripts and would be served from
  // our storage origin.
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Server is not configured for admin actions yet.' }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Malformed upload.' }, { status: 400 });
  }

  const collegeId = String(form.get('college_id') ?? '');
  if (!UUID_RE.test(collegeId)) {
    return NextResponse.json({ error: 'Missing or invalid college id.' }, { status: 400 });
  }

  const { data: college, error: readErr } = await admin
    .from('colleges')
    .select('id, name, banner_url')
    .eq('id', collegeId)
    .maybeSingle();
  if (readErr) {
    if (isServiceKeyProblem(readErr)) {
      return NextResponse.json({ error: SERVICE_KEY_MESSAGE }, { status: 503 });
    }
    return NextResponse.json({ error: `Could not read the college: ${readErr.message}` }, { status: 500 });
  }
  if (!college) return NextResponse.json({ error: 'That college no longer exists.' }, { status: 404 });

  const warnings: string[] = [];

  // Description text may ride the same request, with or without a file.
  const rawDescription = form.get('description');
  if (typeof rawDescription === 'string') {
    const description = rawDescription.trim() || null;
    const { error: descErr } = await admin
      .from('colleges')
      .update({ description })
      .eq('id', collegeId);
    if (descErr) {
      return NextResponse.json({ error: `Could not save the description: ${descErr.message}` }, { status: 500 });
    }
  }

  const file = form.get('file');
  let bannerUrl: string | null = college.banner_url;

  if (file instanceof File && file.size > 0) {
    const ext = EXT_BY_TYPE[file.type];
    if (!ext) {
      return NextResponse.json({ error: 'Banners must be JPG, PNG or WEBP images.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'That image is over 4MB — please use a smaller one.' }, { status: 413 });
    }

    // Timestamped name rather than a fixed per-college one: public objects are
    // CDN-cached, so overwriting in place would keep serving the stale banner.
    const path = `${collegeId}-${Date.now()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      cacheControl: '31536000',
    });
    if (upErr) {
      return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
    }

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    const { error: dbErr } = await admin
      .from('colleges')
      .update({ banner_url: pub.publicUrl })
      .eq('id', collegeId);
    if (dbErr) {
      // Don't leave an orphan object behind a failed pointer update.
      await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
      return NextResponse.json({ error: `Could not save the banner: ${dbErr.message}` }, { status: 500 });
    }

    // Best-effort cleanup of the file being replaced.
    const oldPath = storagePathFromPublicUrl(college.banner_url, BUCKET);
    if (oldPath) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove([oldPath]);
      if (rmErr) warnings.push(`The previous banner file could not be removed (${rmErr.message}).`);
    }
    bannerUrl = pub.publicUrl;
  }

  return NextResponse.json({ banner_url: bannerUrl, warnings });
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Server is not configured for admin actions yet.' }, { status: 503 });
  }

  let collegeId = '';
  try {
    const body = (await request.json()) as { college_id?: string };
    collegeId = String(body.college_id ?? '');
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }
  if (!UUID_RE.test(collegeId)) {
    return NextResponse.json({ error: 'Missing or invalid college id.' }, { status: 400 });
  }

  const { data: college, error: readErr } = await admin
    .from('colleges')
    .select('id, banner_url')
    .eq('id', collegeId)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: `Could not read the college: ${readErr.message}` }, { status: 500 });
  }
  if (!college) return NextResponse.json({ error: 'That college no longer exists.' }, { status: 404 });

  const warnings: string[] = [];
  const oldPath = storagePathFromPublicUrl(college.banner_url, BUCKET);
  if (oldPath) {
    const { error: rmErr } = await admin.storage.from(BUCKET).remove([oldPath]);
    if (rmErr) warnings.push(`The banner file could not be removed (${rmErr.message}).`);
  }

  const { error: dbErr } = await admin
    .from('colleges')
    .update({ banner_url: null })
    .eq('id', collegeId);
  if (dbErr) {
    return NextResponse.json({ error: `Could not clear the banner: ${dbErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ removed: true, warnings });
}
