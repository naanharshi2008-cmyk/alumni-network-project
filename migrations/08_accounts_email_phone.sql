-- =============================================================================
-- Veveaham Alumni — Migration 08: sign in with email or phone, not a username
-- =============================================================================
-- The owner asked to remove usernames entirely. People sign in with the email
-- or phone number they registered with.
--
-- Design: Supabase's auth email stays an OPAQUE HANDLE
-- (<something>@veveaham-alumni-network.com), exactly as existing accounts
-- already have. login_handle() turns an email or phone into that handle, and
-- the browser signs in with it as before. That means:
--   - no existing account has to be migrated, and nobody's password changes;
--   - sign-in still happens in each visitor's own browser, so Supabase's
--     per-IP rate limits apply per person (a server route would put every
--     login behind Vercel's shared IPs);
--   - editing a contact detail never touches the auth account.
--
-- Accepted trade-off: login_handle() and contact_available() reveal whether a
-- contact is registered, as almost every sign-up form does. Neither returns an
-- email, a phone number or a name.
--
-- REQUIRES migration 07 (the guard trigger this file extends).
-- BEFORE PASTING: the test rows "nmmm" and "nn" must be deleted - they share
-- another alumnus's email and phone, and the unique indexes below refuse them.
-- The pre-check aborts with a readable message if any duplicate remains.
--
-- Additive: safe to run while the current site is live. One transaction.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Normalisers
-- -----------------------------------------------------------------------------
-- Email: trimmed and lowercased.
CREATE OR REPLACE FUNCTION public.email_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$ SELECT nullif(lower(btrim(coalesce(p, ''))), '') $$;

-- Phone: digits only, with the country code in front, so "+91 98765 43210",
-- "09876543210" and a 10-digit number typed with code +91 all become
-- "919876543210". Numbers that already carry their country code are left as
-- they are rather than getting it twice.
CREATE OR REPLACE FUNCTION public.phone_key(p_code text, p_number text)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  code   text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  digits text := regexp_replace(coalesce(p_number, ''), '\D', '', 'g');
BEGIN
  IF digits = '' THEN RETURN NULL; END IF;
  digits := regexp_replace(digits, '^0+', '');
  -- A number of only zeros (a placeholder) is no number at all.
  IF digits = '' THEN RETURN NULL; END IF;
  IF code = '' THEN code := '91'; END IF;
  IF length(digits) > 10 AND left(digits, length(code)) = code THEN
    RETURN digits;
  END IF;
  RETURN code || digits;
END
$$;


-- -----------------------------------------------------------------------------
-- 2. Pre-check: refuse to continue while contacts are shared
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  dup_emails int;
  dup_phones int;
BEGIN
  SELECT count(*) INTO dup_emails FROM (
    SELECT public.email_key(personal_email) k FROM public.alumni
    WHERE public.email_key(personal_email) IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1) d;
  SELECT count(*) INTO dup_phones FROM (
    SELECT public.phone_key(phone_country_code, phone_number) k FROM public.alumni
    WHERE public.phone_key(phone_country_code, phone_number) IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1) d;
  IF dup_emails > 0 OR dup_phones > 0 THEN
    RAISE EXCEPTION 'Migration 08 stopped: % email(s) and % phone number(s) are shared by more than one profile. Delete the duplicate test rows in the admin dashboard, then run this again. Nothing was changed.', dup_emails, dup_phones;
  END IF;
END
$$;


-- -----------------------------------------------------------------------------
-- 3. Contact keys and uniqueness
-- -----------------------------------------------------------------------------
-- Plain columns kept current by the guard trigger (section 5), NOT generated
-- columns: Postgres forbids BEFORE triggers from touching generated columns,
-- and the guard rebuilds whole rows for approved profiles.
ALTER TABLE public.alumni
  ADD COLUMN IF NOT EXISTS email_key text,
  ADD COLUMN IF NOT EXISTS phone_key text;



-- -----------------------------------------------------------------------------
-- 4. Public slugs replace usernames in share links
-- -----------------------------------------------------------------------------
-- "elanchearan-r-s-k3f9": readable, unguessable enough not to enumerate, and
-- stable. Old ?p=<username> links keep working in the directory.
CREATE OR REPLACE FUNCTION public.make_public_slug(p_name text)
RETURNS text LANGUAGE sql VOLATILE
SET search_path = ''
AS $$
  SELECT coalesce(nullif(left(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 40), ''), 'alumnus')
         || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5)
$$;

ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS public_slug text;


-- -----------------------------------------------------------------------------
-- 5. Extend the guard trigger from migration 07
-- -----------------------------------------------------------------------------
-- Adds: contact keys are always derived here, and the slug is generated on
-- insert and never user-editable.
CREATE OR REPLACE FUNCTION public.alumni_guard_self_service()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  requested public.alumni;
BEGIN
  IF public.is_school_admin() OR current_user NOT IN ('anon', 'authenticated') THEN
    -- Trusted writers: admins, service-role API routes, the SQL editor.
    IF TG_OP = 'INSERT' AND NEW.public_slug IS NULL THEN
      NEW.public_slug := public.make_public_slug(NEW.full_name);
    END IF;

  ELSIF TG_OP = 'INSERT' THEN
    NEW.user_id             := auth.uid();
    NEW.approval_status     := 'pending';
    NEW.modification_status := 'none';
    NEW.pending_changes     := NULL;
    NEW.rejection_reason    := NULL;
    NEW.school_note         := NULL;
    NEW.public_slug         := public.make_public_slug(NEW.full_name);

  ELSE
    -- Only the school decides these, whatever the row's state.
    NEW.id               := OLD.id;
    NEW.user_id          := OLD.user_id;
    NEW.approval_status  := OLD.approval_status;
    NEW.rejection_reason := OLD.rejection_reason;
    NEW.school_note      := OLD.school_note;
    NEW.public_slug      := OLD.public_slug;

    -- A published profile changes only through review. Its owner may stage
    -- edits, confirm the profile, and keep their private contact details
    -- current. Starting from OLD protects any column added later by default.
    -- Copied field by field: jsonb_populate_record(OLD, ...) reads a column
    -- added later with a default as NULL on older rows (see 07).
    IF OLD.approval_status = 'approved' THEN
      requested := NEW;
      NEW := OLD;
      NEW.pending_changes     := requested.pending_changes;
      NEW.modification_status := CASE WHEN requested.modification_status = 'pending'
                                      THEN 'pending' ELSE OLD.modification_status END;
      NEW.last_confirmed_at   := requested.last_confirmed_at;
      NEW.personal_email      := requested.personal_email;
      NEW.phone_country_code  := requested.phone_country_code;
      NEW.phone_number        := requested.phone_number;
    END IF;
  END IF;

  -- Always derived, never trusted from the request.
  NEW.email_key := public.email_key(NEW.personal_email);
  NEW.phone_key := public.phone_key(NEW.phone_country_code, NEW.phone_number);
  RETURN NEW;
END
$$;

-- Fill the new columns for existing rows (this UPDATE runs the trigger above
-- as a trusted writer), then enforce uniqueness.
UPDATE public.alumni SET personal_email = personal_email;
UPDATE public.alumni SET public_slug = public.make_public_slug(full_name) WHERE public_slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS alumni_email_key_unique
  ON public.alumni (email_key) WHERE email_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS alumni_phone_key_unique
  ON public.alumni (phone_key) WHERE phone_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS alumni_public_slug_unique
  ON public.alumni (public_slug);


-- -----------------------------------------------------------------------------
-- 6. login_handle: email or phone in, opaque auth handle out
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.login_handle(p_identifier text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw    text := btrim(coalesce(p_identifier, ''));
  digits text;
  uid    uuid;
BEGIN
  IF raw = '' OR length(raw) > 120 THEN RETURN NULL; END IF;

  IF position('@' IN raw) > 0 THEN
    SELECT user_id INTO uid FROM alumni
    WHERE email_key = public.email_key(raw) AND user_id IS NOT NULL
    LIMIT 1;
  ELSE
    digits := regexp_replace(raw, '\D', '', 'g');
    IF length(digits) < 7 THEN RETURN NULL; END IF;
    -- Treat a bare number as Indian unless it already carries a code.
    SELECT user_id INTO uid FROM alumni
    WHERE phone_key IN (public.phone_key('+91', digits), public.phone_key('', digits), digits)
      AND user_id IS NOT NULL
    LIMIT 1;
  END IF;

  IF uid IS NULL THEN RETURN NULL; END IF;
  RETURN (SELECT email FROM auth.users WHERE id = uid);
END
$$;

REVOKE ALL ON FUNCTION public.login_handle(text) FROM public;
GRANT EXECUTE ON FUNCTION public.login_handle(text) TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 7. contact_available: booleans only, for the registration and profile forms
-- -----------------------------------------------------------------------------
-- The caller's own row never counts against them, so a profile edit that keeps
-- the same email is not reported as taken.
CREATE OR REPLACE FUNCTION public.contact_available(p_email text, p_phone_code text, p_phone text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'email_free', CASE WHEN public.email_key(p_email) IS NULL THEN true ELSE NOT EXISTS (
      SELECT 1 FROM alumni
      WHERE email_key = public.email_key(p_email)
        AND user_id IS DISTINCT FROM auth.uid()) END,
    'phone_free', CASE WHEN public.phone_key(p_phone_code, p_phone) IS NULL THEN true ELSE NOT EXISTS (
      SELECT 1 FROM alumni
      WHERE phone_key = public.phone_key(p_phone_code, p_phone)
        AND user_id IS DISTINCT FROM auth.uid()) END
  )
$$;

REVOKE ALL ON FUNCTION public.contact_available(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.contact_available(text, text, text) TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 8. Throttle table for the password-reset route
-- -----------------------------------------------------------------------------
-- Written only by the service role (the API route), so RLS on with no policies:
-- invisible and unwritable for everyone else.
CREATE TABLE IF NOT EXISTS public.auth_throttle (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  hits         integer NOT NULL DEFAULT 0
);
ALTER TABLE public.auth_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_throttle FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- 9. Rebuild the public view with public_slug
-- -----------------------------------------------------------------------------
-- STILL EXCLUDED: personal_email, phone_number, phone_country_code, email_key,
-- phone_key, admission_number, user_id, rejection_reason, pending_changes.
DROP VIEW IF EXISTS public_alumni;

CREATE VIEW public_alumni AS
SELECT
  a.id,
  a.full_name,
  a.username,
  a.public_slug,
  a.school_name,
  a.school_board,
  a.class_of,
  a.stream,
  a.degree,
  a.branch,
  a.field,
  a.current_status,
  a.currently_at,
  a.designation,
  a.expected_finish_year,
  a.admission_route,
  a.admission_rank,
  a.board_marks,
  a.board_cutoff,
  a.linkedin_url,
  a.message_1,
  a.message_2,
  a.show_photo,
  CASE WHEN a.show_photo THEN a.photo_url ELSE NULL END AS photo_url,
  a.college_id,
  a.college_name_raw,
  a.created_at,
  a.last_updated,
  a.last_confirmed_at,
  a.school_note,
  a.college_thoughts,
  a.professional_course,
  a.professional_stage,
  a.professional_org,
  CASE WHEN c.id IS NULL THEN NULL ELSE
    jsonb_build_object(
      'name',             c.name,
      'state',            c.state,
      'district',         c.district,
      'website',          c.website,
      'university_name',  c.university_name,
      'management_type',  c.management_type,
      'established_year', c.established_year,
      'is_engineering',   c.is_engineering,
      'banner_url',       c.banner_url,
      'description',      c.description
    )
  END AS colleges
FROM alumni a
LEFT JOIN colleges c ON c.id = a.college_id
WHERE a.approval_status = 'approved';

GRANT SELECT ON public_alumni TO anon, authenticated;

COMMENT ON VIEW public_alumni IS
  'Public, privacy-safe projection of approved alumni. Contact details are intentionally absent. The site reads this instead of the alumni table.';

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFICATION is done after the paste by probing the REST API:
--   login_handle('<a registered email>') -> a handle ending @veveaham-alumni-network.com
--   login_handle('nobody@example.com')   -> null
--   contact_available(...)               -> {"email_free":..,"phone_free":..}
--   public_alumni?select=public_slug     -> 200, one slug per row
-- ROLLBACK: DROP INDEX alumni_email_key_unique, alumni_phone_key_unique;
-- re-run the view block from 06; DROP FUNCTION login_handle, contact_available.
-- =============================================================================
