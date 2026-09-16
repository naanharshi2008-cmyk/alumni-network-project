import { NextResponse } from 'next/server';
import { getAdminClient, requireUser } from '../../../../lib/supabaseAdmin';
import { adminNewRegistrationEmail, sendMail, welcomeEmail } from '../../../../lib/mailer';
import { allowHit, throttleKey } from '../../../../lib/throttle';

export const runtime = 'nodejs';

// Sent right after registration: an alert to the school's admin inbox and a
// welcome email to the new alumnus.
//
// Replaces the old /api/notify-admin, which accepted any JSON from anyone and
// could be used to spam the admin inbox. This one requires the caller's own
// session and reads their details from the database, so nobody can make it
// email an arbitrary address, and each account triggers it at most once.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ sent: false, reason: 'not-configured' });

  const { data: person } = await admin
    .from('alumni')
    .select('full_name, class_of, school_name, college_name_raw, current_status, personal_email, created_at')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (!person) return NextResponse.json({ sent: false, reason: 'no-profile' });

  // Only for a registration that has just happened.
  const ageMs = Date.now() - new Date(person.created_at).getTime();
  if (ageMs > 30 * 60 * 1000) return NextResponse.json({ sent: false, reason: 'not-new' });
  if (!(await allowHit(admin, throttleKey('registered', auth.user.id), 1, 24 * 3600))) {
    return NextResponse.json({ sent: false, reason: 'already-sent' });
  }

  const [alert, welcome] = await Promise.all([
    process.env.ADMIN_EMAIL
      ? sendMail({
          to: process.env.ADMIN_EMAIL.split(',').map((e) => e.trim()).filter(Boolean),
          ...adminNewRegistrationEmail({
            fullName: person.full_name ?? '',
            classOf: String(person.class_of ?? ''),
            school: person.school_name ?? '',
            college: person.college_name_raw ?? '',
            status: person.current_status ?? '',
          }),
        })
      : Promise.resolve({ sent: false as const, reason: 'not-configured' as const }),
    person.personal_email
      ? sendMail({ to: person.personal_email, ...welcomeEmail(person.full_name) })
      : Promise.resolve({ sent: false as const, reason: 'bad-recipient' as const }),
  ]);
  return NextResponse.json({ adminAlert: alert, welcome });
}
