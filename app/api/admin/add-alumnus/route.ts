import { NextResponse } from 'next/server';
import { getAdminClient, requireAdmin, safeErrorMessage } from '../../../../lib/supabaseAdmin';
import { issueLogin } from '../../../../lib/issueLogin';
import { emailKey, phoneKey, phoneProblem } from '../../../../lib/contactKeys';
import { boardForSchool, officialSchoolName, SCHOOLS, STREAMS, COUNTRY_CODES } from '../../../../lib/options';

/**
 * The school enters an alumnus itself, and hands them the way in.
 *
 * Not everyone will fill the form: the office often knows the name, the batch
 * and a phone number long before the person gets round to it. This creates the
 * profile from what the school has and, when asked, issues a temporary
 * password in the same breath, so the alumnus signs in and finishes their own
 * profile rather than the school inventing the rest.
 *
 * It is deliberately a small form. Everything a senior actually says to a
 * junior - the advice, the college experience, what they are doing now - is
 * theirs to write, so the row starts as a stub waiting for review rather than
 * a published profile with the school's guesses in it.
 *
 * Written with the service role because an insert here has to set what
 * self-service can never set (`user_id`, the review state) and must not depend
 * on the admin's own row-level rights to do it.
 */

export const runtime = 'nodejs';

const THIS_YEAR = new Date().getFullYear();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

type Body = {
  full_name?: string;
  class_of?: string | number;
  school_name?: string;
  stream?: string;
  personal_email?: string;
  phone_country_code?: string;
  phone_number?: string;
  college_name?: string;
  school_note?: string;
  create_login?: boolean;
};

function clean(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: 'Server is not configured yet.' }, { status: 503 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const fullName = clean(body.full_name, 80);
  if (fullName.length < 2) return NextResponse.json({ error: 'Enter their full name.' }, { status: 400 });

  const classOf = Number.parseInt(String(body.class_of ?? ''), 10);
  if (!Number.isFinite(classOf) || classOf < 1980 || classOf > THIS_YEAR + 1) {
    return NextResponse.json({ error: `Class of must be between 1980 and ${THIS_YEAR + 1}.` }, { status: 400 });
  }

  const school = officialSchoolName(body.school_name);
  if (!(SCHOOLS as readonly string[]).includes(school)) {
    return NextResponse.json({ error: 'Choose which of our schools they went to.' }, { status: 400 });
  }

  // The one thing beyond a name and a batch the office always has on record,
  // and the column the rest of the site groups people by.
  const stream = clean(body.stream, 60);
  if (!STREAMS.includes(stream)) {
    return NextResponse.json({ error: 'Choose the stream they took at school.' }, { status: 400 });
  }

  const email = clean(body.personal_email, 120).toLowerCase();
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 });
  }

  const code = clean(body.phone_country_code, 6) || '+91';
  const phone = clean(body.phone_number, 20);
  if (phone) {
    if (!COUNTRY_CODES.includes(code)) {
      return NextResponse.json({ error: 'Pick a country code from the list.' }, { status: 400 });
    }
    const problem = phoneProblem(code, phone);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const wantsLogin = body.create_login !== false;
  if (wantsLogin && !email && !phone) {
    return NextResponse.json(
      { error: 'A login needs an email or a phone number — that is what they sign in with.' },
      { status: 400 },
    );
  }

  // The same contact cannot belong to two profiles: it is how people sign in.
  // Checked here for a readable answer, and enforced by the unique indexes on
  // email_key / phone_key whatever this says.
  const eKey = emailKey(email);
  const pKey = phoneKey(code, phone);
  for (const [column, value, label] of [['email_key', eKey, 'email address'], ['phone_key', pKey, 'phone number']] as const) {
    if (!value) continue;
    const { data: clash } = await admin.from('alumni').select('full_name').eq(column, value).maybeSingle();
    if (clash) {
      return NextResponse.json(
        { error: `That ${label} is already on ${clash.full_name}'s profile.` },
        { status: 409 },
      );
    }
  }

  const { data: inserted, error: insErr } = await admin
    .from('alumni')
    .insert({
      user_id: null,
      full_name: fullName,
      school_name: school,
      school_board: boardForSchool(school),
      class_of: classOf,
      stream,
      personal_email: email || null,
      phone_country_code: phone ? code : null,
      phone_number: phone || null,
      college_name_raw: clean(body.college_name, 120) || null,
      school_note: clean(body.school_note, 300) || null,
      // Added by the school, so nobody has agreed to anything yet, and there is
      // nothing worth publishing until they fill it in themselves.
      consent_given: false,
      approval_status: 'pending',
      modification_status: 'none',
      show_photo: false,
    })
    .select('id, full_name, public_slug')
    .single();

  if (insErr || !inserted) {
    return NextResponse.json({ error: `Could not add them: ${safeErrorMessage(insErr)}` }, { status: 500 });
  }

  if (!wantsLogin) return NextResponse.json({ id: inserted.id, name: inserted.full_name });

  const issued = await issueLogin(admin, inserted.id);
  if (!issued.ok) {
    // The profile is real and useful on its own; say plainly that only the
    // login failed, so nobody adds the person a second time.
    return NextResponse.json(
      { id: inserted.id, name: inserted.full_name, loginError: issued.error },
      { status: 207 },
    );
  }

  return NextResponse.json({
    id: inserted.id,
    name: inserted.full_name,
    temporaryPassword: issued.temporaryPassword,
    signInWith: email || `${code} ${phone}`,
  });
}
