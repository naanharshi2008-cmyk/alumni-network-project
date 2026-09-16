import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/supabaseAdmin';
import { mailHealth } from '../../../../lib/mailer';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  return NextResponse.json(await mailHealth());
}
